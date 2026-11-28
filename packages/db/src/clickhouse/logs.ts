import type { ClickHouseClient } from '@clickhouse/client'
import { ISO_TIMES } from './buckets'
import { toClickHouseTime } from './events'
import type { CompiledLogQuery } from './log-query'

/** One row of `logs`, as the worker writes it. */
export interface LogRow {
  org_id: string
  project_id: string
  source_id: string
  /** UTC with nanoseconds, "2026-11-28 12:00:00.123456789". */
  timestamp: string
  observed_at: string
  severity_number: number
  /** trace, debug, info, warn, error or fatal. */
  level: string
  service: string
  body: string
  trace_id: string
  span_id: string
  scope: string
  attributes: Record<string, string>
  resource: Record<string, string>
  /** Values masked before storing. */
  masked: number
  retention_days: number
}

/** What the ingest queues: the worker adds the product's retention. */
export type QueuedLog = Omit<LogRow, 'retention_days'>

/** Days a product keeps its log lines unless it chose otherwise. */
export const DEFAULT_LOG_RETENTION_DAYS = 14
/** The choices on Set up Logs. */
export const LOG_RETENTION_CHOICES = [7, 14, 30, 90] as const

export async function insertLogs(client: ClickHouseClient, rows: LogRow[], token?: string) {
  if (rows.length === 0) return
  await client.insert({
    table: 'logs',
    values: rows,
    format: 'JSONEachRow',
    clickhouse_settings: token ? { insert_deduplication_token: token } : {},
  })
}

export interface LogScope {
  orgId: string
  projectIds: string[]
  /** Only these sources; empty or left out, every source. */
  sourceIds?: string[]
  from: Date
  to: Date
}

const IN_SOURCES = `(empty({sources:Array(UUID)}) OR source_id IN {sources:Array(UUID)})`
const IN_SCOPE = `org_id = {org:UUID} AND project_id IN {projects:Array(UUID)} AND ${IN_SOURCES}
  AND timestamp >= {from:DateTime64(3, 'UTC')} AND timestamp < {to:DateTime64(3, 'UTC')}`

function scopeParams(scope: LogScope) {
  return {
    org: scope.orgId,
    projects: scope.projectIds,
    sources: scope.sourceIds ?? [],
    from: toClickHouseTime(scope.from),
    to: toClickHouseTime(scope.to),
  }
}

/** A line as the list shows it. */
export interface LogLine {
  projectId: string
  sourceId: string
  /** ISO 8601 with up to nanoseconds, UTC: "2026-11-28T12:00:00.123456789Z". */
  timestamp: string
  level: string
  service: string
  body: string
  traceId: string
  spanId: string
  scope: string
  attributes: Record<string, string>
  resource: Record<string, string>
  masked: number
}

interface LineRow {
  project_id: string
  source_id: string
  timestamp: string
  level: string
  service: string
  body: string
  trace_id: string
  span_id: string
  scope: string
  attributes: Record<string, string>
  resource: Record<string, string>
  masked: number
}

const LINE_COLUMNS = `project_id, source_id, timestamp, level, service, body, trace_id, span_id,
  scope, attributes, resource, masked`

const toLine = (row: LineRow): LogLine => ({
  projectId: row.project_id,
  sourceId: row.source_id,
  timestamp: row.timestamp.endsWith('Z') ? row.timestamp : `${row.timestamp}Z`,
  level: row.level,
  service: row.service,
  body: row.body,
  traceId: row.trace_id,
  spanId: row.span_id,
  scope: row.scope,
  attributes: row.attributes,
  resource: row.resource,
  masked: Number(row.masked),
})

/** "2026-11-28T12:00:00.123456789Z" as ClickHouse reads a DateTime64(9). */
export function logTimeParam(iso: string): string {
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d{1,9})?Z?$/)
  if (!match) throw new Error(`not a log time: ${iso}`)
  return `${match[1]} ${match[2]}${match[3] ?? ''}`
}

/**
 * Lines matching the query, newest first. `before` pages back ("Load older")
 * and `after` takes only what arrived since the newest line on screen (Live).
 */
export async function searchLogs(
  client: ClickHouseClient,
  scope: LogScope,
  query: CompiledLogQuery,
  options: { limit: number; before?: string; after?: string },
): Promise<LogLine[]> {
  if (scope.projectIds.length === 0) return []
  const cursor = [
    options.before ? `AND timestamp < {before:DateTime64(9, 'UTC')}` : '',
    options.after ? `AND timestamp > {after:DateTime64(9, 'UTC')}` : '',
  ].join(' ')
  const result = await client.query({
    query: `
      SELECT ${LINE_COLUMNS}
      FROM logs
      WHERE ${IN_SCOPE} ${cursor} AND (${query.where})
      ORDER BY timestamp DESC
      LIMIT {limit:UInt32}`,
    query_params: {
      ...scopeParams(scope),
      ...query.params,
      before: options.before ? logTimeParam(options.before) : undefined,
      after: options.after ? logTimeParam(options.after) : undefined,
      limit: options.limit,
    },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  return (await result.json<LineRow>()).map(toLine)
}

export interface LogBucket {
  at: Date
  error: number
  warn: number
  info: number
}

/**
 * Lines per slice of the period by level: error (with fatal), warn and the
 * rest. Slices are `seconds` long; empty ones are filled with zeros.
 */
export async function logHistogram(
  client: ClickHouseClient,
  scope: LogScope,
  query: CompiledLogQuery,
  seconds: number,
): Promise<LogBucket[]> {
  if (scope.projectIds.length === 0) return []
  const result = await client.query({
    query: `
      SELECT
        toStartOfInterval(timestamp, toIntervalSecond({step:UInt32})) AS at,
        countIf(level IN ('error', 'fatal')) AS error,
        countIf(level = 'warn') AS warn,
        countIf(level NOT IN ('error', 'fatal', 'warn')) AS info
      FROM logs
      WHERE ${IN_SCOPE} AND (${query.where})
      GROUP BY at
      ORDER BY at`,
    query_params: { ...scopeParams(scope), ...query.params, step: seconds },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ at: string; error: string; warn: string; info: string }>()
  const found = new Map(
    rows.map((r) => [
      new Date(r.at).getTime(),
      { error: Number(r.error), warn: Number(r.warn), info: Number(r.info) },
    ]),
  )
  const step = seconds * 1000
  const out: LogBucket[] = []
  const first = Math.floor(scope.from.getTime() / step) * step
  for (let t = first; t < scope.to.getTime(); t += step) {
    out.push({ at: new Date(t), ...(found.get(t) ?? { error: 0, warn: 0, info: 0 }) })
  }
  return out
}

/** Values masked before storing in the period, for "Octadash masked N values". */
export async function maskedCount(client: ClickHouseClient, scope: LogScope): Promise<number> {
  if (scope.projectIds.length === 0) return 0
  const result = await client.query({
    query: `SELECT sum(masked) AS masked FROM logs WHERE ${IN_SCOPE}`,
    query_params: scopeParams(scope),
    format: 'JSONEachRow',
  })
  const [row] = await result.json<{ masked: string }>()
  return Number(row?.masked ?? 0)
}

/**
 * About how many bytes a product's lines take on disk per day: the size of
 * the last 24 hours as sent, times how much the table compresses. An estimate
 * for "About 1.2 GB for 14 days", not billing.
 */
export async function logBytesPerDay(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  now = new Date(),
): Promise<number> {
  const result = await client.query({
    query: `
      SELECT
        (SELECT sum(length(body) + length(toString(attributes)) + length(toString(resource)) + 120)
         FROM logs
         WHERE org_id = {org:UUID} AND project_id = {project:UUID}
           AND timestamp >= {from:DateTime64(3, 'UTC')} AND timestamp < {to:DateTime64(3, 'UTC')}) AS raw,
        (SELECT if(sum(data_uncompressed_bytes) = 0, 0.15,
                   sum(data_compressed_bytes) / sum(data_uncompressed_bytes))
         FROM system.parts
         WHERE database = currentDatabase() AND table = 'logs' AND active) AS ratio`,
    query_params: {
      org: orgId,
      project: projectId,
      from: toClickHouseTime(new Date(now.getTime() - 86_400_000)),
      to: toClickHouseTime(now),
    },
    format: 'JSONEachRow',
  })
  const [row] = await result.json<{ raw: string | null; ratio: number }>()
  return Math.round(Number(row?.raw ?? 0) * Number(row?.ratio ?? 0.15))
}

/** The newest line a source sent, for the live check on Set up Logs. */
export async function lastLogLine(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  sourceId: string,
): Promise<{ at: string; service: string; body: string } | null> {
  const result = await client.query({
    query: `
      SELECT timestamp, service, body
      FROM logs
      WHERE org_id = {org:UUID} AND project_id = {project:UUID} AND source_id = {source:UUID}
        AND timestamp >= now() - INTERVAL 7 DAY
      ORDER BY timestamp DESC
      LIMIT 1`,
    query_params: { org: orgId, project: projectId, source: sourceId },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const [row] = await result.json<{ timestamp: string; service: string; body: string }>()
  if (!row) return null
  const at = row.timestamp.endsWith('Z') ? row.timestamp : `${row.timestamp}Z`
  return { at, service: row.service, body: row.body.slice(0, 200) }
}

/** Errors that happened in the given traces, for "1 error in Errors" on a line. */
export async function errorsInTraces(
  client: ClickHouseClient,
  orgId: string,
  traceIds: string[],
): Promise<Map<string, { count: number; issueId: string; projectId: string }>> {
  const ids = [...new Set(traceIds.filter(Boolean))]
  if (ids.length === 0) return new Map()
  const result = await client.query({
    query: `
      SELECT trace_id, count() AS count, any(issue_id) AS issue_id, any(project_id) AS project_id
      FROM errors
      WHERE org_id = {org:UUID} AND trace_id IN {ids:Array(String)}
      GROUP BY trace_id`,
    query_params: { org: orgId, ids },
    format: 'JSONEachRow',
  })
  const rows = await result.json<{
    trace_id: string
    count: string
    issue_id: string
    project_id: string
  }>()
  return new Map(
    rows.map((r) => [
      r.trace_id,
      { count: Number(r.count), issueId: r.issue_id, projectId: r.project_id },
    ]),
  )
}

/** Per product, the lines a saved search matched since `since`, and the newest. */
export async function logMatches(
  client: ClickHouseClient,
  orgId: string,
  projectIds: string[],
  query: CompiledLogQuery,
  since: Date,
  now = new Date(),
): Promise<{ projectId: string; count: number; last: Date }[]> {
  if (projectIds.length === 0) return []
  const result = await client.query({
    query: `
      SELECT project_id, count() AS count, max(timestamp) AS last
      FROM logs
      WHERE ${IN_SCOPE} AND (${query.where})
      GROUP BY project_id`,
    query_params: {
      ...scopeParams({ orgId, projectIds, from: since, to: new Date(now.getTime() + 60_000) }),
      ...query.params,
    },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ project_id: string; count: string; last: string }>()
  return rows.map((r) => ({
    projectId: r.project_id,
    count: Number(r.count),
    last: new Date(r.last.endsWith('Z') ? r.last : `${r.last}Z`),
  }))
}

/**
 * Shortens what a product keeps: lines older than `days` are deleted now
 * instead of waiting for the retention they arrived with. ClickHouse runs it
 * in the background.
 */
export async function trimLogs(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  days: number,
) {
  await client.command({
    query: `
      ALTER TABLE logs DELETE
      WHERE org_id = {org:UUID} AND project_id = {project:UUID}
        AND timestamp < now() - toIntervalDay({days:UInt16})`,
    query_params: { org: orgId, project: projectId, days },
  })
}
