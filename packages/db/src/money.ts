import { sql } from 'kysely'
import type { Db } from './client'

/** How a product of a connection picks its payments. */
export type ConnectionRule =
  | { mode: 'all' }
  | { mode: 'products'; values: string[] }
  | { mode: 'metadata'; values: string[] }

export interface ConnectionInput {
  integration: string
  name: string
  /** JSON of the secrets, already encrypted. */
  secrets: string
  keyHint: string
  webhookToken: string
}

export async function createConnection(db: Db, orgId: string, id: string, input: ConnectionInput) {
  return db
    .insertInto('connection')
    .values({
      id,
      org_id: orgId,
      integration: input.integration,
      name: input.name.trim(),
      secrets: input.secrets,
      key_hint: input.keyHint,
      webhook_token: input.webhookToken,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export function listConnections(db: Db, orgId: string) {
  return db
    .selectFrom('connection')
    .selectAll()
    .where('org_id', '=', orgId)
    .orderBy('created_at')
    .execute()
}

export type ConnectionRow = Awaited<ReturnType<typeof listConnections>>[number]

/** Every connection of every organization, for the worker's sync. */
export function listAllConnections(db: Db) {
  return db.selectFrom('connection').selectAll().orderBy('created_at').execute()
}

export function getConnection(db: Db, orgId: string, id: string) {
  return db
    .selectFrom('connection')
    .selectAll()
    .where('org_id', '=', orgId)
    .where('id', '=', id)
    .executeTakeFirst()
}

/** The connection a webhook URL points to. */
export function connectionByToken(db: Db, integration: string, token: string) {
  return db
    .selectFrom('connection')
    .selectAll()
    .where('integration', '=', integration)
    .where('webhook_token', '=', token)
    .executeTakeFirst()
}

export async function updateConnection(
  db: Db,
  orgId: string,
  id: string,
  patch: { name?: string; secrets?: string; keyHint?: string },
) {
  return db
    .updateTable('connection')
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.secrets !== undefined ? { secrets: patch.secrets } : {}),
      ...(patch.keyHint !== undefined ? { key_hint: patch.keyHint } : {}),
      updated_at: new Date(),
    })
    .where('org_id', '=', orgId)
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirst()
}

/** What the worker records after reading a gateway. */
export async function markConnection(
  db: Db,
  id: string,
  patch: {
    status?: 'importing' | 'ok' | 'failing'
    lastError?: string | null
    importedAt?: Date | null
    syncedAt?: Date
    subscriptionsSyncedAt?: Date
    webhookAt?: Date
  },
) {
  await db
    .updateTable('connection')
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.lastError !== undefined ? { last_error: patch.lastError } : {}),
      ...(patch.importedAt !== undefined ? { imported_at: patch.importedAt } : {}),
      ...(patch.syncedAt ? { synced_at: patch.syncedAt } : {}),
      ...(patch.subscriptionsSyncedAt
        ? { subscriptions_synced_at: patch.subscriptionsSyncedAt }
        : {}),
      ...(patch.webhookAt ? { webhook_at: patch.webhookAt } : {}),
    })
    .where('id', '=', id)
    .execute()
}

export async function deleteConnection(db: Db, orgId: string, id: string) {
  const result = await db
    .deleteFrom('connection')
    .where('org_id', '=', orgId)
    .where('id', '=', id)
    .executeTakeFirst()
  return Number(result.numDeletedRows) > 0
}

/** Serves a product from a connection, or changes how it picks its payments. */
export async function setConnectionProject(
  db: Db,
  orgId: string,
  connectionId: string,
  projectId: string,
  rule: ConnectionRule,
) {
  const values = rule.mode === 'all' ? [] : [...new Set(rule.values.map((v) => v.trim()))]
  await db
    .insertInto('connection_project')
    .values({
      connection_id: connectionId,
      project_id: projectId,
      org_id: orgId,
      mode: rule.mode,
      values,
    })
    .onConflict((oc) =>
      oc.columns(['connection_id', 'project_id']).doUpdateSet({ mode: rule.mode, values }),
    )
    .execute()
}

export async function removeConnectionProject(
  db: Db,
  orgId: string,
  connectionId: string,
  projectId: string,
) {
  await db
    .deleteFrom('connection_project')
    .where('org_id', '=', orgId)
    .where('connection_id', '=', connectionId)
    .where('project_id', '=', projectId)
    .execute()
}

export interface ConnectionProject {
  connectionId: string
  projectId: string
  rule: ConnectionRule
}

/** The products each connection serves; `orgId` null for every organization. */
export async function listConnectionProjects(
  db: Db,
  orgId: string | null,
): Promise<ConnectionProject[]> {
  let query = db.selectFrom('connection_project').selectAll()
  if (orgId) query = query.where('org_id', '=', orgId)
  const rows = await query.orderBy('created_at').execute()
  return rows.map((row) => ({
    connectionId: row.connection_id,
    projectId: row.project_id,
    rule:
      row.mode === 'products' || row.mode === 'metadata'
        ? { mode: row.mode, values: row.values }
        : { mode: 'all' },
  }))
}

/** Units of each currency per US dollar, by day ("2026-11-28"). */
export type FxRates = Map<string, Map<string, number>>

export async function saveFxRates(
  db: Db,
  rows: { day: string; currency: string; perUsd: number }[],
) {
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000)
    await db
      .insertInto('fx_rate')
      .values(chunk.map((r) => ({ day: r.day, currency: r.currency, per_usd: r.perUsd })))
      .onConflict((oc) =>
        oc
          .columns(['day', 'currency'])
          .doUpdateSet((eb) => ({ per_usd: eb.ref('excluded.per_usd') })),
      )
      .execute()
  }
}

/** The newest day with rates, or null before the first fetch. */
export async function latestFxDay(db: Db): Promise<string | null> {
  const row = await db
    .selectFrom('fx_rate')
    .select(sql<string>`to_char(max(day), 'YYYY-MM-DD')`.as('day'))
    .executeTakeFirst()
  return row?.day ?? null
}

/**
 * Rates from `from` to `to` (days, inclusive), plus the last day before
 * `from`, so a day without its own rate takes the one before.
 */
export async function fxRates(db: Db, from: string, to: string): Promise<FxRates> {
  const rows = await db
    .selectFrom('fx_rate')
    .select([sql<string>`to_char(day, 'YYYY-MM-DD')`.as('day'), 'currency', 'per_usd'])
    .where((eb) =>
      eb.or([
        eb.between('day', from, to),
        eb(
          'day',
          '=',
          eb.selectFrom('fx_rate').select(sql<string>`max(day)`.as('d')).where('day', '<', from),
        ),
      ]),
    )
    .orderBy('day')
    .execute()
  const out: FxRates = new Map()
  for (const row of rows) {
    const day = out.get(row.day) ?? new Map<string, number>()
    out.set(row.day, day)
    day.set(row.currency, Number(row.per_usd))
  }
  return out
}

/** Digits after the decimal point of a currency: 2 for BRL, 0 for JPY. */
export function currencyDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

/**
 * An amount in minor units of one currency as minor units of another, at the
 * rate of `day` or the last day before it with one. Null when either
 * currency has no rate yet.
 */
export function convertMinor(
  amount: number,
  from: string,
  to: string,
  day: string,
  rates: FxRates,
): number | null {
  if (from === to) return amount
  const rate = (currency: string) => {
    if (currency === 'USD') return 1
    let best: number | undefined
    for (const [d, map] of rates) {
      if (d > day) break
      best = map.get(currency) ?? best
    }
    if (best === undefined) {
      // Older than the first rate: take the first one there is.
      for (const map of rates.values()) {
        const value = map.get(currency)
        if (value !== undefined) return value
      }
    }
    return best
  }
  const source = rate(from)
  const target = rate(to)
  if (!source || !target) return null
  const major = amount / 10 ** currencyDigits(from)
  return Math.round((major / source) * target * 10 ** currencyDigits(to))
}
