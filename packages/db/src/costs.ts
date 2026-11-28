import { sql } from 'kysely'
import type { Db } from './client'

/**
 * Costs in Postgres: how each product shares a connection, fixed bills,
 * what providers charged per day and per hour, and budgets. The division
 * itself (`splitCost`) lives with the providers in @octadash/integrations.
 */

export type CostSplit = 'equal' | 'traffic' | 'percent'

export interface CostShareInput {
  tags: string[]
  rest: boolean
  percent: number | null
}

export async function setConnectionSplit(db: Db, orgId: string, id: string, split: CostSplit) {
  await db
    .updateTable('connection')
    .set({ split, updated_at: new Date() })
    .where('org_id', '=', orgId)
    .where('id', '=', id)
    .execute()
}

/** A product takes part of a connection's cost, or changes its part. */
export async function setCostShare(
  db: Db,
  orgId: string,
  connectionId: string,
  projectId: string,
  share: CostShareInput,
) {
  const tags = [...new Set(share.tags.map((t) => t.trim()).filter(Boolean))]
  const percent = share.percent === null ? null : Math.max(0, Math.min(100, share.percent))
  await db
    .insertInto('cost_share')
    .values({
      connection_id: connectionId,
      project_id: projectId,
      org_id: orgId,
      tags,
      rest: share.rest,
      percent,
    })
    .onConflict((oc) =>
      oc.columns(['connection_id', 'project_id']).doUpdateSet({ tags, rest: share.rest, percent }),
    )
    .execute()
}

export async function removeCostShare(
  db: Db,
  orgId: string,
  connectionId: string,
  projectId: string,
) {
  await db
    .deleteFrom('cost_share')
    .where('org_id', '=', orgId)
    .where('connection_id', '=', connectionId)
    .where('project_id', '=', projectId)
    .execute()
}

export interface CostShareRow extends CostShareInput {
  connectionId: string
  projectId: string
}

/** Every product's part of every connection; `orgId` null for every organization. */
export async function listCostShares(db: Db, orgId: string | null): Promise<CostShareRow[]> {
  let query = db.selectFrom('cost_share').selectAll()
  if (orgId) query = query.where('org_id', '=', orgId)
  const rows = await query.orderBy('created_at').execute()
  return rows.map((row) => ({
    connectionId: row.connection_id,
    projectId: row.project_id,
    tags: row.tags,
    rest: row.rest,
    percent: row.percent === null ? null : Number(row.percent),
  }))
}

export interface CostSplitVersion {
  connectionId: string
  /** "2026-11-28": the division holds from this day until the next version. */
  validFrom: string
  split: CostSplit
  shares: CostShareRow[]
}

/**
 * Keeps a copy of a connection's whole division from `day` (by default
 * today in the organization's time zone), after its split or a product's part
 * changed. A second change on the same day replaces the first.
 */
export async function recordCostSplit(db: Db, orgId: string, connectionId: string, day?: string) {
  const connection = await db
    .selectFrom('connection')
    .select('split')
    .where('org_id', '=', orgId)
    .where('id', '=', connectionId)
    .executeTakeFirst()
  if (!connection) return
  const shares = (await listCostShares(db, orgId))
    .filter((s) => s.connectionId === connectionId)
    .map(({ projectId, tags, rest, percent }) => ({ projectId, tags, rest, percent }))
  const validFrom =
    day ??
    (
      await sql<{ day: string }>`
        select to_char((now() at time zone coalesce(
          (select time_zone from organization_settings where org_id = ${orgId}), 'UTC'))::date,
          'YYYY-MM-DD') as day`.execute(db)
    ).rows[0]?.day ??
    new Date().toISOString().slice(0, 10)
  const values = { split: connection.split, shares: JSON.stringify(shares) }
  await db
    .insertInto('cost_split_history')
    .values({ connection_id: connectionId, org_id: orgId, valid_from: validFrom, ...values })
    .onConflict((oc) => oc.columns(['connection_id', 'valid_from']).doUpdateSet(values))
    .execute()
}

/** Every version of every connection's division, oldest first. */
export async function listCostSplitHistory(db: Db, orgId: string): Promise<CostSplitVersion[]> {
  const rows = await db
    .selectFrom('cost_split_history')
    .select([
      'connection_id',
      sql<string>`to_char(valid_from, 'YYYY-MM-DD')`.as('valid_from'),
      'split',
      'shares',
    ])
    .where('org_id', '=', orgId)
    .orderBy('connection_id')
    .orderBy('valid_from')
    .execute()
  return rows.map((row) => ({
    connectionId: row.connection_id,
    validFrom: row.valid_from,
    split: (['equal', 'traffic', 'percent'].includes(row.split) ? row.split : 'equal') as CostSplit,
    shares: (row.shares as Omit<CostShareRow, 'connectionId'>[]).map((s) => ({
      connectionId: row.connection_id,
      projectId: s.projectId,
      tags: s.tags ?? [],
      rest: Boolean(s.rest),
      percent: s.percent === null || s.percent === undefined ? null : Number(s.percent),
    })),
  }))
}

/**
 * The division that holds on `day`: the last version from that day or
 * before. Days before the first version (costs read back from before the
 * connection existed) use the first one.
 */
export function splitOn<T extends { validFrom: string }>(
  versions: T[],
  day: string,
): T | undefined {
  let found: T | undefined
  for (const v of versions) {
    if (v.validFrom <= day) found = v
    else break
  }
  return found ?? versions[0]
}

export interface FixedCost {
  connectionId: string
  /** Minor units. */
  amount: number
  currency: string
  every: 'month' | 'year'
  /** "2026-11-01" */
  startsOn: string
}

export async function saveFixedCost(db: Db, orgId: string, input: FixedCost) {
  const values = {
    amount: Math.round(input.amount),
    currency: input.currency.toUpperCase(),
    every: input.every,
    starts_on: input.startsOn,
  }
  await db
    .insertInto('fixed_cost')
    .values({ connection_id: input.connectionId, org_id: orgId, ...values })
    .onConflict((oc) => oc.column('connection_id').doUpdateSet(values))
    .execute()
}

export async function listFixedCosts(db: Db, orgId: string): Promise<FixedCost[]> {
  const rows = await db
    .selectFrom('fixed_cost')
    .select([
      'connection_id',
      'amount',
      'currency',
      'every',
      sql<string>`to_char(starts_on, 'YYYY-MM-DD')`.as('starts_on'),
    ])
    .where('org_id', '=', orgId)
    .execute()
  return rows.map((row) => ({
    connectionId: row.connection_id,
    amount: Number(row.amount),
    currency: row.currency,
    every: row.every === 'year' ? 'year' : 'month',
    startsOn: row.starts_on,
  }))
}

const DAY = 86_400_000

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * A fixed bill counted day by day, so a month adds up to the bill: a monthly
 * bill is divided by the days of each month, a yearly one by the days of the
 * year. Days from `from` to `to` (inclusive, "YYYY-MM-DD"), never before the
 * bill starts.
 */
export function fixedCostDays(
  bill: Pick<FixedCost, 'amount' | 'every' | 'startsOn'>,
  from: string,
  to: string,
): { day: string; amount: number }[] {
  const out: { day: string; amount: number }[] = []
  const start = Math.max(Date.parse(`${from}T00:00:00Z`), Date.parse(`${bill.startsOn}T00:00:00Z`))
  const end = Date.parse(`${to}T00:00:00Z`)
  for (let t = start; t <= end; t += DAY) {
    const d = new Date(t)
    const year = d.getUTCFullYear()
    const days =
      bill.every === 'year'
        ? (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY
        : new Date(Date.UTC(year, d.getUTCMonth() + 1, 0)).getUTCDate()
    out.push({ day: isoDay(t), amount: bill.amount / days })
  }
  return out
}

export interface CostDay {
  connectionId: string
  day: string
  tag: string
  lineItem: string
  amount: number
  currency: string
}

/** Replaces what was read for each day in `days`, so a re-read day loses rows that went away. */
export async function saveCostDays(
  db: Db,
  orgId: string,
  connectionId: string,
  days: string[],
  rows: Omit<CostDay, 'connectionId'>[],
) {
  await db.transaction().execute(async (trx) => {
    if (days.length > 0)
      await trx
        .deleteFrom('cost_day')
        .where('connection_id', '=', connectionId)
        .where('day', 'in', days)
        .execute()
    for (let i = 0; i < rows.length; i += 1000) {
      await trx
        .insertInto('cost_day')
        .values(
          rows.slice(i, i + 1000).map((r) => ({
            connection_id: connectionId,
            org_id: orgId,
            day: r.day,
            tag: r.tag,
            line_item: r.lineItem,
            amount: r.amount,
            currency: r.currency,
          })),
        )
        .onConflict((oc) =>
          oc.columns(['connection_id', 'day', 'tag', 'line_item']).doUpdateSet((eb) => ({
            amount: eb.ref('excluded.amount'),
            currency: eb.ref('excluded.currency'),
            updated_at: new Date(),
          })),
        )
        .execute()
    }
  })
}

/** A connection's total per tag on one day, before a read replaces it. */
export async function costDayTotals(
  db: Db,
  connectionId: string,
  day: string,
): Promise<Map<string, number>> {
  const rows = await db
    .selectFrom('cost_day')
    .select(['tag', sql<number>`sum(amount)`.as('amount')])
    .where('connection_id', '=', connectionId)
    .where('day', '=', day)
    .groupBy('tag')
    .execute()
  return new Map(rows.map((r) => [r.tag, Number(r.amount)]))
}

export async function listCostDays(
  db: Db,
  orgId: string,
  from: string,
  to: string,
): Promise<CostDay[]> {
  const rows = await db
    .selectFrom('cost_day')
    .select([
      'connection_id',
      sql<string>`to_char(day, 'YYYY-MM-DD')`.as('day'),
      'tag',
      'line_item',
      sql<number>`sum(amount)`.as('amount'),
      'currency',
    ])
    .where('org_id', '=', orgId)
    .where('day', '>=', from)
    .where('day', '<=', to)
    .groupBy(['connection_id', 'day', 'tag', 'line_item', 'currency'])
    .execute()
  return rows.map((r) => ({
    connectionId: r.connection_id,
    day: r.day,
    tag: r.tag,
    lineItem: r.line_item,
    amount: Number(r.amount),
    currency: r.currency,
  }))
}

export interface CostHour {
  connectionId: string
  hour: Date
  tag: string
  amount: number
  currency: string
}

/** Hours read from the provider replace what was there; growth between reads adds to it. */
export async function saveCostHours(
  db: Db,
  orgId: string,
  connectionId: string,
  rows: Omit<CostHour, 'connectionId'>[],
  mode: 'set' | 'add',
) {
  for (let i = 0; i < rows.length; i += 1000) {
    await db
      .insertInto('cost_hour')
      .values(
        rows.slice(i, i + 1000).map((r) => ({
          connection_id: connectionId,
          org_id: orgId,
          hour: r.hour,
          tag: r.tag,
          amount: r.amount,
          currency: r.currency,
        })),
      )
      .onConflict((oc) =>
        oc.columns(['connection_id', 'hour', 'tag']).doUpdateSet((eb) => ({
          amount:
            mode === 'add'
              ? sql<number>`${eb.ref('cost_hour.amount')} + ${eb.ref('excluded.amount')}`
              : eb.ref('excluded.amount'),
        })),
      )
      .execute()
  }
}

export async function listCostHours(
  db: Db,
  orgId: string | null,
  from: Date,
): Promise<(CostHour & { orgId: string })[]> {
  let query = db
    .selectFrom('cost_hour')
    .select(['connection_id', 'org_id', 'hour', 'tag', 'amount', 'currency'])
    .where('hour', '>=', from)
  if (orgId) query = query.where('org_id', '=', orgId)
  const rows = await query.orderBy('hour').execute()
  return rows.map((r) => ({
    connectionId: r.connection_id,
    orgId: r.org_id,
    hour: r.hour,
    tag: r.tag,
    amount: Number(r.amount),
    currency: r.currency,
  }))
}

/** Hours older than `before` are no longer needed: runaway looks at the last week. */
export async function trimCostHours(db: Db, before: Date) {
  await db.deleteFrom('cost_hour').where('hour', '<', before).execute()
}

export interface CostBudget {
  projectId: string
  /** Minor units of the organization's currency. */
  amount: number
  /** Percent of the budget at which the forecast warns. */
  warn: number
}

/** Sets a product's monthly budget, or clears it with null. */
export async function setCostBudget(
  db: Db,
  orgId: string,
  projectId: string,
  budget: { amount: number; warn: number } | null,
) {
  if (!budget) {
    await db
      .deleteFrom('cost_budget')
      .where('org_id', '=', orgId)
      .where('project_id', '=', projectId)
      .execute()
    return
  }
  const values = {
    amount: Math.round(budget.amount),
    warn: Math.max(1, Math.min(100, Math.round(budget.warn))),
    updated_at: new Date(),
  }
  await db
    .insertInto('cost_budget')
    .values({ project_id: projectId, org_id: orgId, ...values })
    .onConflict((oc) => oc.column('project_id').doUpdateSet(values))
    .execute()
}

export async function listCostBudgets(db: Db, orgId: string): Promise<CostBudget[]> {
  const rows = await db.selectFrom('cost_budget').selectAll().where('org_id', '=', orgId).execute()
  return rows.map((r) => ({ projectId: r.project_id, amount: Number(r.amount), warn: r.warn }))
}

/** Each connection's spend per tag over whole days, for every organization: the runaway baseline. */
export async function costTotalsByTag(
  db: Db,
  from: string,
  to: string,
): Promise<{ orgId: string; connectionId: string; tag: string; amount: number }[]> {
  const rows = await db
    .selectFrom('cost_day')
    .select(['org_id', 'connection_id', 'tag', sql<number>`sum(amount)`.as('amount')])
    .where('day', '>=', from)
    .where('day', '<=', to)
    .groupBy(['org_id', 'connection_id', 'tag'])
    .execute()
  return rows.map((r) => ({
    orgId: r.org_id,
    connectionId: r.connection_id,
    tag: r.tag,
    amount: Number(r.amount),
  }))
}
