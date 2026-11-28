import type { ClickHouseClient } from '@clickhouse/client'

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

/** Uptime, response time and the last state of each monitor over the last `days`. */
export async function monitorStats(
  client: ClickHouseClient,
  orgId: string,
  monitorIds: string[],
  days = 30,
): Promise<Map<string, MonitorStats>> {
  const stats = new Map<string, MonitorStats>()
  if (monitorIds.length === 0) return stats
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
        AND timestamp >= now64(3) - toIntervalDay({days:UInt32})
      GROUP BY monitor_id`,
    query_params: { org: orgId, ids: monitorIds, days },
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
