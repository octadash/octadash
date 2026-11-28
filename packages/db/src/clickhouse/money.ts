import { createHash } from 'node:crypto'
import type { ClickHouseClient } from '@clickhouse/client'
import { ISO_TIMES } from './buckets'
import { toClickHouseTime } from './events'

/** One row of `payments`. Times as "2026-11-28 01:12:04.218", UTC. */
export interface PaymentRow {
  org_id: string
  project_id: string
  connection_id: string
  gateway: string
  id: string
  status: string
  amount: number
  refunded: number
  fee: number | null
  currency: string
  method: string
  customer: string
  subscription_id: string
  at: string
  failure: string
  updated_at: string
}

export interface SubscriptionRow {
  org_id: string
  project_id: string
  connection_id: string
  gateway: string
  id: string
  status: string
  mrr: number
  currency: string
  customer: string
  started_at: string
  canceled_at: string | null
  updated_at: string
}

export async function insertPayments(client: ClickHouseClient, rows: PaymentRow[]) {
  if (rows.length === 0) return
  await client.insert({ table: 'payments', values: rows, format: 'JSONEachRow' })
}

export async function insertSubscriptions(client: ClickHouseClient, rows: SubscriptionRow[]) {
  if (rows.length === 0) return
  await client.insert({ table: 'subscriptions', values: rows, format: 'JSONEachRow' })
}

const iso = (value: string) => new Date(value.endsWith('Z') ? value : `${value}Z`)

/**
 * When each of these subscriptions was first seen ended, for gateways that do
 * not say (Asaas): a later sync must not move the date forward.
 */
export async function knownEnds(
  client: ClickHouseClient,
  orgId: string,
  connectionId: string,
  ids: string[],
): Promise<Map<string, Date>> {
  if (ids.length === 0) return new Map()
  const result = await client.query({
    query: `
      SELECT id, min(canceled_at) AS ended
      FROM subscriptions
      WHERE org_id = {org:UUID} AND connection_id = {connection:UUID} AND id IN {ids:Array(String)}
        AND canceled_at IS NOT NULL
      GROUP BY id`,
    query_params: { org: orgId, connection: connectionId, ids },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ id: string; ended: string }>()
  return new Map(rows.map((r) => [r.id, iso(r.ended)]))
}

export interface MoneyScope {
  orgId: string
  projectIds: string[]
  from: Date
  to: Date
}

const IN_SCOPE = `org_id = {org:UUID} AND project_id IN {projects:Array(UUID)}`

const scopeParams = (scope: MoneyScope) => ({
  org: scope.orgId,
  projects: scope.projectIds,
  from: toClickHouseTime(scope.from),
  to: toClickHouseTime(scope.to),
})

/** Per product, local hour or day, and currency: what came in, went back and failed. */
export interface PaymentDay {
  projectId: string
  /** Start of the bucket (local hour or day) the row covers. */
  at: Date
  /** "2026-11-28" in the organization's time zone. */
  day: string
  currency: string
  /** Charged and paid (including what was refunded later), in minor units. */
  paid: number
  refunded: number
  fee: number
  paidCount: number
  failedCount: number
  /** The part of `paid` not tied to a subscription: one-off sales, credit packs. */
  oneOffPaid: number
  oneOffCount: number
}

export async function paymentDays(
  client: ClickHouseClient,
  scope: MoneyScope,
  timeZone: string,
  bucket: 'hour' | 'day' = 'day',
): Promise<PaymentDay[]> {
  if (scope.projectIds.length === 0) return []
  const result = await client.query({
    query: `
      SELECT
        project_id,
        ${bucket === 'hour' ? 'toStartOfHour' : 'toStartOfDay'}(at, {tz:String}) AS start,
        toString(toDate(at, {tz:String})) AS day,
        currency,
        sumIf(amount, status IN ('paid', 'refunded')) AS paid,
        sum(refunded) AS refunded,
        sumIf(ifNull(fee, 0), status IN ('paid', 'refunded')) AS fee,
        countIf(status IN ('paid', 'refunded')) AS paid_count,
        countIf(status = 'failed') AS failed_count,
        sumIf(amount, status IN ('paid', 'refunded') AND subscription_id = '') AS one_off_paid,
        countIf(status IN ('paid', 'refunded') AND subscription_id = '') AS one_off_count
      FROM payments FINAL
      WHERE ${IN_SCOPE}
        AND at >= {from:DateTime64(3, 'UTC')} AND at < {to:DateTime64(3, 'UTC')}
      GROUP BY project_id, start, day, currency
      ORDER BY start`,
    query_params: { ...scopeParams(scope), tz: timeZone },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{
    project_id: string
    start: string
    day: string
    currency: string
    paid: string
    refunded: string
    fee: string
    paid_count: string
    failed_count: string
    one_off_paid: string
    one_off_count: string
  }>()
  return rows.map((r) => ({
    projectId: r.project_id,
    at: iso(r.start),
    day: r.day,
    currency: r.currency,
    paid: Number(r.paid),
    refunded: Number(r.refunded),
    fee: Number(r.fee),
    paidCount: Number(r.paid_count),
    failedCount: Number(r.failed_count),
    oneOffPaid: Number(r.one_off_paid),
    oneOffCount: Number(r.one_off_count),
  }))
}

/**
 * How each product is paid for, read from what it sold in the last year:
 * subscriptions (`recurring`), payments with no subscription such as one-off
 * sales and credit packs (`oneOff`), or both. Money picks its numbers from
 * this, so a product sold one purchase at a time never shows an MRR of zero.
 */
export interface PaymentKind {
  projectId: string
  recurring: boolean
  oneOff: boolean
}

export async function paymentKinds(
  client: ClickHouseClient,
  orgId: string,
  projectIds: string[],
  since: Date,
): Promise<PaymentKind[]> {
  if (projectIds.length === 0) return []
  const params = { org: orgId, projects: projectIds, since: toClickHouseTime(since) }
  const [payments, subscriptions] = await Promise.all([
    client
      .query({
        query: `
          SELECT
            project_id,
            countIf(subscription_id != '') > 0 AS recurring,
            countIf(subscription_id = '') > 0 AS one_off
          FROM payments FINAL
          WHERE ${IN_SCOPE} AND status IN ('paid', 'refunded')
            AND at >= {since:DateTime64(3, 'UTC')}
          GROUP BY project_id`,
        query_params: params,
        format: 'JSONEachRow',
      })
      .then((r) => r.json<{ project_id: string; recurring: number; one_off: number }>()),
    client
      .query({
        query: `
          SELECT DISTINCT project_id
          FROM subscriptions FINAL
          WHERE ${IN_SCOPE} AND status != 'trialing'
            AND (canceled_at IS NULL OR canceled_at >= {since:DateTime64(3, 'UTC')})`,
        query_params: params,
        format: 'JSONEachRow',
      })
      .then((r) => r.json<{ project_id: string }>()),
  ])
  const kinds = new Map<string, PaymentKind>()
  const of = (projectId: string) => {
    const kind = kinds.get(projectId) ?? { projectId, recurring: false, oneOff: false }
    kinds.set(projectId, kind)
    return kind
  }
  for (const r of payments) {
    const kind = of(r.project_id)
    kind.recurring ||= Number(r.recurring) > 0
    kind.oneOff ||= Number(r.one_off) > 0
  }
  for (const r of subscriptions) of(r.project_id).recurring = true
  return [...kinds.values()]
}

export interface BuyerCounts {
  projectId: string
  /** Customers who paid for something outside a subscription in the period. */
  buyers: number
  /** Of those, the ones who had already paid before the period. */
  returning: number
}

/**
 * Who bought in the period, for products sold one purchase at a time.
 * Payments with no customer (a guest checkout) count in revenue, not here.
 */
export async function buyerCounts(
  client: ClickHouseClient,
  scope: MoneyScope,
): Promise<BuyerCounts[]> {
  if (scope.projectIds.length === 0) return []
  const result = await client.query({
    query: `
      SELECT
        project_id,
        uniqExact(customer) AS buyers,
        uniqExactIf(customer, (project_id, customer) IN (
          SELECT project_id, customer FROM payments FINAL
          WHERE ${IN_SCOPE} AND subscription_id = '' AND customer != ''
            AND status IN ('paid', 'refunded') AND at < {from:DateTime64(3, 'UTC')}
        )) AS returning
      FROM payments FINAL
      WHERE ${IN_SCOPE} AND subscription_id = '' AND customer != ''
        AND status IN ('paid', 'refunded')
        AND at >= {from:DateTime64(3, 'UTC')} AND at < {to:DateTime64(3, 'UTC')}
      GROUP BY project_id`,
    query_params: scopeParams(scope),
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ project_id: string; buyers: string; returning: string }>()
  return rows.map((r) => ({
    projectId: r.project_id,
    buyers: Number(r.buyers),
    returning: Number(r.returning),
  }))
}

export interface MrrPoint {
  at: Date
  projectId: string
  currency: string
  /** Minor units per month. */
  mrr: number
  /** Subscriptions counted. */
  count: number
  /** Customers paying. */
  customers: number
}

/**
 * MRR at each of these moments: subscriptions started by then and not yet
 * ended, without trials. It uses each subscription's current price, so a
 * plan change moves the whole history (movements are on the backlog).
 */
export async function mrrAt(
  client: ClickHouseClient,
  orgId: string,
  projectIds: string[],
  times: Date[],
): Promise<MrrPoint[]> {
  if (projectIds.length === 0 || times.length === 0) return []
  const result = await client.query({
    query: `
      SELECT
        t,
        project_id,
        currency,
        sum(mrr) AS mrr,
        count() AS count,
        uniqExact(customer) AS customers
      FROM (SELECT * FROM subscriptions FINAL WHERE ${IN_SCOPE} AND status != 'trialing')
      ARRAY JOIN {times:Array(DateTime64(3, 'UTC'))} AS t
      WHERE started_at <= t AND (canceled_at IS NULL OR canceled_at > t)
      GROUP BY t, project_id, currency
      ORDER BY t`,
    query_params: {
      org: orgId,
      projects: projectIds,
      times: times.map(toClickHouseTime),
    },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{
    t: string
    project_id: string
    currency: string
    mrr: string
    count: string
    customers: string
  }>()
  return rows.map((r) => ({
    at: iso(r.t),
    projectId: r.project_id,
    currency: r.currency,
    mrr: Number(r.mrr),
    count: Number(r.count),
    customers: Number(r.customers),
  }))
}

export interface SubscriptionChanges {
  projectId: string
  /** Active when the period began. */
  atStart: number
  started: number
  ended: number
}

/** New and ended subscriptions in the period, per product, for New subscriptions and Churn. */
export async function subscriptionChanges(
  client: ClickHouseClient,
  scope: MoneyScope,
): Promise<SubscriptionChanges[]> {
  if (scope.projectIds.length === 0) return []
  const result = await client.query({
    query: `
      SELECT
        project_id,
        countIf(started_at < {from:DateTime64(3, 'UTC')}
          AND (canceled_at IS NULL OR canceled_at >= {from:DateTime64(3, 'UTC')})) AS at_start,
        countIf(started_at >= {from:DateTime64(3, 'UTC')} AND started_at < {to:DateTime64(3, 'UTC')}) AS started,
        countIf(canceled_at >= {from:DateTime64(3, 'UTC')} AND canceled_at < {to:DateTime64(3, 'UTC')}
          AND started_at < {from:DateTime64(3, 'UTC')}) AS ended
      FROM subscriptions FINAL
      WHERE ${IN_SCOPE} AND status != 'trialing'
      GROUP BY project_id`,
    query_params: scopeParams(scope),
    format: 'JSONEachRow',
  })
  const rows = await result.json<{
    project_id: string
    at_start: string
    started: string
    ended: string
  }>()
  return rows.map((r) => ({
    projectId: r.project_id,
    atStart: Number(r.at_start),
    started: Number(r.started),
    ended: Number(r.ended),
  }))
}

export interface PaymentRate {
  orgId: string
  projectId: string
  paid: number
  failed: number
}

/**
 * Charges paid and failed since `since`, per product. `orgId` null reads every
 * organization, for the "Payments failing" check.
 */
export async function paymentRates(
  client: ClickHouseClient,
  since: Date,
  scope: { orgId: string; projectIds: string[] } | null = null,
): Promise<PaymentRate[]> {
  if (scope && scope.projectIds.length === 0) return []
  const result = await client.query({
    query: `
      SELECT
        org_id,
        project_id,
        countIf(status IN ('paid', 'refunded')) AS paid,
        countIf(status = 'failed') AS failed
      FROM payments FINAL
      WHERE at >= {since:DateTime64(3, 'UTC')} ${scope ? `AND ${IN_SCOPE}` : ''}
      GROUP BY org_id, project_id`,
    query_params: {
      since: toClickHouseTime(since),
      ...(scope ? { org: scope.orgId, projects: scope.projectIds } : {}),
    },
    format: 'JSONEachRow',
  })
  const rows = await result.json<{
    org_id: string
    project_id: string
    paid: string
    failed: string
  }>()
  return rows.map((r) => ({
    orgId: r.org_id,
    projectId: r.project_id,
    paid: Number(r.paid),
    failed: Number(r.failed),
  }))
}

export interface LatestPayment {
  projectId: string
  gateway: string
  id: string
  status: string
  amount: number
  currency: string
  method: string
  subscription: boolean
  at: Date
  failure: string
}

/** The newest payments, for the live list. */
export async function latestPayments(
  client: ClickHouseClient,
  orgId: string,
  projectIds: string[],
  limit = 20,
): Promise<LatestPayment[]> {
  if (projectIds.length === 0) return []
  const result = await client.query({
    query: `
      SELECT project_id, gateway, id, status, amount, currency, method, subscription_id, at, failure
      FROM payments FINAL
      WHERE ${IN_SCOPE}
      ORDER BY at DESC
      LIMIT {limit:UInt32}`,
    query_params: { org: orgId, projects: projectIds, limit },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{
    project_id: string
    gateway: string
    id: string
    status: string
    amount: string
    currency: string
    method: string
    subscription_id: string
    at: string
    failure: string
  }>()
  return rows.map((r) => ({
    projectId: r.project_id,
    gateway: r.gateway,
    id: r.id,
    status: r.status,
    amount: Number(r.amount),
    currency: r.currency,
    method: r.method,
    subscription: r.subscription_id !== '',
    at: iso(r.at),
    failure: r.failure,
  }))
}

/** Removes what a connection brought, when it is deleted. ClickHouse runs it in the background. */
export async function deleteConnectionData(
  client: ClickHouseClient,
  orgId: string,
  connectionId: string,
) {
  for (const table of ['payments', 'subscriptions']) {
    await client.command({
      query: `ALTER TABLE ${table} DELETE WHERE org_id = {org:UUID} AND connection_id = {connection:UUID}`,
      query_params: { org: orgId, connection: connectionId },
    })
  }
}

/** A payment as the gateways give it (see @octadash/integrations money types). */
export interface StorablePayment {
  id: string
  status: string
  amount: number
  refunded: number
  fee: number | null
  currency: string
  method: string
  customer: string
  subscriptionId: string
  at: Date
  failure: string
  products: string[]
  tag: string
}

export interface StorableSubscription {
  id: string
  status: string
  mrr: number
  currency: string
  customer: string
  startedAt: Date
  canceledAt: Date | null
  products: string[]
  tag: string
}

const customerHash = (connectionId: string, customer: string) =>
  customer
    ? createHash('sha256').update(`${connectionId}:${customer}`).digest('hex').slice(0, 32)
    : ''

/**
 * Writes what a gateway gave: each item goes to the product `projectOf`
 * picks, and items no product picks are left out. A subscription keeps the
 * first end date Octadash saw for it. Returns how many rows were written.
 */
export async function storeMoney(
  client: ClickHouseClient,
  connection: { orgId: string; connectionId: string; gateway: string },
  projectOf: (item: { products: string[]; tag: string }) => string | null,
  items: { payments: StorablePayment[]; subscriptions: StorableSubscription[] },
  now = new Date(),
): Promise<{ payments: number; subscriptions: number }> {
  const base = {
    org_id: connection.orgId,
    connection_id: connection.connectionId,
    gateway: connection.gateway,
    updated_at: toClickHouseTime(now),
  }
  const payments: PaymentRow[] = []
  for (const p of items.payments) {
    const project = projectOf(p)
    if (!project) continue
    payments.push({
      ...base,
      project_id: project,
      id: p.id,
      status: p.status,
      amount: p.amount,
      refunded: p.refunded,
      fee: p.fee,
      currency: p.currency,
      method: p.method,
      customer: customerHash(connection.connectionId, p.customer),
      subscription_id: p.subscriptionId,
      at: toClickHouseTime(p.at),
      failure: p.failure,
    })
  }
  const ends = await knownEnds(
    client,
    connection.orgId,
    connection.connectionId,
    items.subscriptions.filter((s) => s.canceledAt).map((s) => s.id),
  )
  const subscriptions: SubscriptionRow[] = []
  for (const s of items.subscriptions) {
    const project = projectOf(s)
    if (!project) continue
    const known = ends.get(s.id)
    const ended = s.canceledAt && known && known < s.canceledAt ? known : s.canceledAt
    subscriptions.push({
      ...base,
      project_id: project,
      id: s.id,
      status: s.status,
      mrr: s.mrr,
      currency: s.currency,
      customer: customerHash(connection.connectionId, s.customer),
      started_at: toClickHouseTime(s.startedAt),
      canceled_at: ended ? toClickHouseTime(ended) : null,
    })
  }
  await insertPayments(client, payments)
  await insertSubscriptions(client, subscriptions)
  return { payments: payments.length, subscriptions: subscriptions.length }
}
