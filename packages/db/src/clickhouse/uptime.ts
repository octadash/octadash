import type { ClickHouseClient } from '@clickhouse/client'
import { type Bucket, bucketSql, bucketStarts, ISO_TIMES } from './buckets'
import { toClickHouseTime } from './events'
import type { TrafficScope } from './traffic'

/** One row of `uptime_checks`. */
export interface UptimeCheckRow {
  org_id: string
  project_id: string
  monitor_id: string
  /** UTC, "2026-11-28 12:00:00.000". */
  timestamp: string
  up: 0 | 1
  status_code: number | null
  duration_ms: number | null
  error: string
  cert_days: number | null
}

export async function insertUptimeChecks(client: ClickHouseClient, rows: UptimeCheckRow[]) {
  if (rows.length === 0) return
  await client.insert({ table: 'uptime_checks', values: rows, format: 'JSONEachRow' })
}

export interface MonitorStats {
  monitorId: string
  checks: number
  /** Share of checks that were up, 0 to 1. Null without checks. */
  uptime: number | null
  /** Median response time of the checks that were up, in milliseconds. */
  medianMs: number | null
  lastAt: Date | null
  lastUp: boolean | null
  lastError: string | null
  /** Days until the certificate expires, from the latest deep check. */
  certDays: number | null
}

interface StatsRow {
  /** Not named monitor_id: in ClickHouse an alias would shadow the column in WHERE. */
  id: string
  checks: string
  ups: string
  median_ms: number | null
  last_at: string | null
  last_up: number | null
  last_error: string | null
  cert_days: number | null
}

/**
 * Uptime, response time and the last state of each monitor over the last
 * `days`, or between two moments.
 */
export async function monitorStats(
  client: ClickHouseClient,
  orgId: string,
  monitorIds: string[],
  period: number | { from: Date; to: Date } = 30,
): Promise<Map<string, MonitorStats>> {
  const stats = new Map<string, MonitorStats>()
  if (monitorIds.length === 0) return stats
  const to = typeof period === 'number' ? new Date() : period.to
  const from =
    typeof period === 'number' ? new Date(to.getTime() - period * 86_400_000) : period.from
  const result = await client.query({
    query: `
      SELECT
        toString(monitor_id) AS id,
        count() AS checks,
        countIf(up = 1) AS ups,
        quantileIf(0.5)(duration_ms, up = 1 AND duration_ms IS NOT NULL) AS median_ms,
        max(timestamp) AS last_at,
        argMax(up, timestamp) AS last_up,
        argMax(error, timestamp) AS last_error,
        argMaxIf(cert_days, timestamp, cert_days IS NOT NULL) AS cert_days
      FROM uptime_checks
      WHERE org_id = {org:UUID}
        AND monitor_id IN {ids:Array(UUID)}
        AND timestamp >= {from:DateTime64(3, 'UTC')}
        AND timestamp < {to:DateTime64(3, 'UTC')}
      GROUP BY monitor_id`,
    query_params: {
      org: orgId,
      ids: monitorIds,
      from: toClickHouseTime(from),
      to: toClickHouseTime(to),
    },
    format: 'JSONEachRow',
  })
  for (const row of await result.json<StatsRow>()) {
    const checks = Number(row.checks)
    stats.set(row.id, {
      monitorId: row.id,
      checks,
      uptime: checks > 0 ? Number(row.ups) / checks : null,
      medianMs:
        row.median_ms === null || Number.isNaN(row.median_ms) ? null : Math.round(row.median_ms),
      lastAt: row.last_at ? new Date(`${row.last_at.replace(' ', 'T')}Z`) : null,
      lastUp: row.last_up === null ? null : row.last_up === 1,
      lastError: row.last_error || null,
      certDays: row.cert_days,
    })
  }
  return stats
}

export interface UptimeTotals {
  checks: number
  ups: number
  /** Median response time of every check that answered, in milliseconds. */
  medianMs: number | null
}

/** All checks of a scope at once: the "Uptime" and "Response" tiles of the Uptime board. */
export async function uptimeTotals(
  client: ClickHouseClient,
  scope: TrafficScope,
): Promise<UptimeTotals> {
  if (scope.projectIds?.length === 0) return { checks: 0, ups: 0, medianMs: null }
  const result = await client.query({
    query: `
      SELECT
        count() AS checks,
        countIf(up = 1) AS ups,
        quantileIf(0.5)(duration_ms, up = 1 AND duration_ms IS NOT NULL) AS median_ms
      FROM uptime_checks
      WHERE org_id = {org:UUID}
        ${scope.projectIds ? 'AND project_id IN {projects:Array(UUID)}' : ''}
        AND timestamp >= {from:DateTime64(3, 'UTC')}
        AND timestamp < {to:DateTime64(3, 'UTC')}`,
    query_params: {
      org: scope.orgId,
      projects: scope.projectIds ?? [],
      from: toClickHouseTime(scope.from),
      to: toClickHouseTime(scope.to),
    },
    format: 'JSONEachRow',
  })
  const [row] = await result.json<{ checks: string; ups: string; median_ms: number | null }>()
  const median = row?.median_ms
  return {
    checks: Number(row?.checks ?? 0),
    ups: Number(row?.ups ?? 0),
    medianMs: median == null || Number.isNaN(median) ? null : Math.round(median),
  }
}

/** Days left on each monitor's certificate, from its latest deep check in the last two days. */
export async function latestCertDays(
  client: ClickHouseClient,
  monitorIds: string[],
): Promise<Map<string, number>> {
  const days = new Map<string, number>()
  if (monitorIds.length === 0) return days
  const result = await client.query({
    query: `
      SELECT toString(monitor_id) AS id, argMax(cert_days, timestamp) AS days
      FROM uptime_checks
      WHERE monitor_id IN {ids:Array(UUID)}
        AND cert_days IS NOT NULL
        AND timestamp >= now64(3) - toIntervalDay(2)
      GROUP BY monitor_id`,
    query_params: { ids: monitorIds },
    format: 'JSONEachRow',
  })
  for (const row of await result.json<{ id: string; days: number }>()) days.set(row.id, row.days)
  return days
}

export interface UptimeBucket {
  /** Start of the bucket. */
  at: Date
  checks: number
  /** Checks that failed: one is enough to paint the bucket as down. */
  downs: number
}

export interface ProductUptimeHistory {
  checks: number
  ups: number
  /** Every bucket of the period, empty ones included (no checks). */
  buckets: UptimeBucket[]
}

/**
 * Checks per product (or per monitor) and per hour or day, for the bar of
 * hours in an overview row. Paused or deleted monitors count while they had checks. Products with
 * no check in the period are left out.
 */
export async function uptimeHistory(
  client: ClickHouseClient,
  scope: TrafficScope,
  bucket: Bucket,
  /** `monitor`: one history per monitor instead, for a product's monitor list. */
  by: 'product' | 'monitor' = 'product',
): Promise<Map<string, ProductUptimeHistory>> {
  const history = new Map<string, ProductUptimeHistory>()
  if (scope.projectIds?.length === 0) return history
  const { start } = bucketSql(bucket)
  const result = await client.query({
    query: `
      SELECT
        toString(${by === 'monitor' ? 'monitor_id' : 'project_id'}) AS product,
        ${start}(timestamp, {tz:String}) AS at,
        count() AS checks,
        countIf(up = 0) AS downs
      FROM uptime_checks
      WHERE org_id = {org:UUID}
        ${scope.projectIds ? 'AND project_id IN {projects:Array(UUID)}' : ''}
        AND timestamp >= {from:DateTime64(3, 'UTC')}
        AND timestamp < {to:DateTime64(3, 'UTC')}
      GROUP BY product, at
      ORDER BY product, at`,
    query_params: {
      org: scope.orgId,
      projects: scope.projectIds ?? [],
      from: toClickHouseTime(scope.from),
      to: toClickHouseTime(scope.to),
      tz: scope.timeZone ?? 'UTC',
    },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ product: string; at: string; checks: string; downs: string }>()
  const starts = await bucketStarts(client, scope, bucket)
  const found = new Map<string, Map<number, UptimeBucket>>()
  for (const row of rows) {
    const byTime = found.get(row.product) ?? new Map<number, UptimeBucket>()
    const at = new Date(row.at)
    byTime.set(at.getTime(), { at, checks: Number(row.checks), downs: Number(row.downs) })
    found.set(row.product, byTime)
  }
  for (const [product, byTime] of found) {
    let checks = 0
    let downs = 0
    for (const b of byTime.values()) {
      checks += b.checks
      downs += b.downs
    }
    history.set(product, {
      checks,
      ups: checks - downs,
      buckets: starts.map((at) => byTime.get(at.getTime()) ?? { at, checks: 0, downs: 0 }),
    })
  }
  return history
}

/**
 * Median response time of the checks that answered, per hour or day: the
 * "Response time" tab of a product's chart. Empty buckets come back as null.
 */
export async function responseSeries(
  client: ClickHouseClient,
  scope: TrafficScope,
  bucket: Bucket,
): Promise<{ at: Date; medianMs: number | null }[]> {
  if (scope.projectIds?.length === 0) return []
  const { start } = bucketSql(bucket)
  const result = await client.query({
    query: `
      SELECT
        ${start}(timestamp, {tz:String}) AS at,
        quantileIf(0.5)(duration_ms, up = 1 AND duration_ms IS NOT NULL) AS median_ms
      FROM uptime_checks
      WHERE org_id = {org:UUID}
        ${scope.projectIds ? 'AND project_id IN {projects:Array(UUID)}' : ''}
        AND timestamp >= {from:DateTime64(3, 'UTC')}
        AND timestamp < {to:DateTime64(3, 'UTC')}
      GROUP BY at
      ORDER BY at`,
    query_params: {
      org: scope.orgId,
      projects: scope.projectIds ?? [],
      from: toClickHouseTime(scope.from),
      to: toClickHouseTime(scope.to),
      tz: scope.timeZone ?? 'UTC',
    },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ at: string; median_ms: number | null }>()
  const found = new Map(
    rows.map((row) => [
      new Date(row.at).getTime(),
      row.median_ms === null || Number.isNaN(row.median_ms) ? null : Math.round(row.median_ms),
    ]),
  )
  const starts = await bucketStarts(client, scope, bucket)
  return starts.map((at) => ({ at, medianMs: found.get(at.getTime()) ?? null }))
}

export interface CheckPoint {
  at: Date
  up: boolean
  statusCode: number | null
  durationMs: number | null
  error: string
}

/**
 * Every check of one monitor in a window, oldest first: the chart and the
 * first failure on an emergency's page. A monitor checked every 30 seconds
 * gives 120 rows an hour, so the window stays short.
 */
export async function monitorChecks(
  client: ClickHouseClient,
  orgId: string,
  monitorId: string,
  from: Date,
  to: Date,
): Promise<CheckPoint[]> {
  const result = await client.query({
    query: `
      SELECT timestamp AS at, up, status_code, duration_ms, error
      FROM uptime_checks
      WHERE org_id = {org:UUID}
        AND monitor_id = {monitor:UUID}
        AND timestamp >= {from:DateTime64(3, 'UTC')}
        AND timestamp < {to:DateTime64(3, 'UTC')}
      ORDER BY timestamp
      LIMIT 2000`,
    query_params: {
      org: orgId,
      monitor: monitorId,
      from: toClickHouseTime(from),
      to: toClickHouseTime(to),
    },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{
    at: string
    up: number
    status_code: number | null
    duration_ms: number | null
    error: string
  }>()
  return rows.map((row) => ({
    at: new Date(row.at),
    up: row.up === 1,
    statusCode: row.status_code,
    durationMs: row.duration_ms,
    error: row.error,
  }))
}
