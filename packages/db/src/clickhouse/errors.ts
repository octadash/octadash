import type { ClickHouseClient } from '@clickhouse/client'
import { type Bucket, bucketSql, ISO_TIMES } from './buckets'
import { toClickHouseTime } from './events'

/** One frame of a stack trace, innermost last (the order Sentry uses). */
export interface ErrorFrame {
  filename: string
  function: string
  module?: string
  lineno?: number
  colno?: number
  in_app: boolean
  /** Source lines around the frame, when the SDK or a source map gave them. */
  context_line?: string
  pre_context?: string[]
  post_context?: string[]
}

/** One exception of an event; chained causes come first, the one thrown last. */
export interface ErrorException {
  type: string
  value: string
  mechanism?: { type?: string; handled?: boolean }
  frames: ErrorFrame[]
}

export interface ErrorBreadcrumb {
  timestamp: number
  category: string
  type: string
  level: string
  message: string
  data?: Record<string, unknown>
}

/** One row of `errors`, as the worker writes it. */
export interface ErrorRow {
  org_id: string
  project_id: string
  source_id: string
  issue_id: string
  event_id: string
  fingerprint: string
  /** UTC, "2026-11-28 12:00:00.000". */
  timestamp: string
  received_at: string
  type: string
  value: string
  level: string
  handled: number
  platform: string
  sdk: string
  release: string
  environment: string
  /** Where it happened: the function and file of the top frame of the app's own code. */
  culprit: string
  url: string
  path: string
  browser: string
  os: string
  country: string
  person: string
  /** JSON of ErrorException[]. */
  exception: string
  /** JSON of ErrorBreadcrumb[]. */
  breadcrumbs: string
  /** JSON object of string tags. */
  tags: string
  /** The trace it happened in, lowercase hex; empty when the SDK sent none. */
  trace_id: string
  /** The whole event as sent, masked (JSON). Empty for rows queued before it existed. */
  event?: string
}

/** What the ingest queues: a row before the worker knows its issue. */
export type QueuedError = Omit<ErrorRow, 'issue_id'>

export async function insertErrors(client: ClickHouseClient, rows: ErrorRow[], token?: string) {
  if (rows.length === 0) return
  await client.insert({
    table: 'errors',
    values: rows,
    format: 'JSONEachRow',
    clickhouse_settings: token ? { insert_deduplication_token: token } : {},
  })
}

/** People an issue hit: the app's user when it sent one, else the daily visitor hash. */
const PERSON = `nullIf(person, '')`

export interface ErrorScope {
  orgId: string
  projectIds: string[]
  from: Date
  to: Date
  timeZone?: string
}

function scopeParams(scope: ErrorScope) {
  return {
    org: scope.orgId,
    projects: scope.projectIds,
    from: toClickHouseTime(scope.from),
    to: toClickHouseTime(scope.to),
    tz: scope.timeZone ?? 'UTC',
  }
}

const IN_SCOPE = `org_id = {org:UUID} AND project_id IN {projects:Array(UUID)}
  AND timestamp >= {from:DateTime64(3, 'UTC')} AND timestamp < {to:DateTime64(3, 'UTC')}`

/** People an issue hit since a time; "ignore until N more people" reads it. */
export async function issuePeople(
  client: ClickHouseClient,
  issueId: string,
  since: Date,
): Promise<number> {
  const result = await client.query({
    query: `SELECT uniq(${PERSON}) AS people FROM errors
      WHERE issue_id = {issue:UUID} AND timestamp >= {since:DateTime64(3, 'UTC')}`,
    query_params: { issue: issueId, since: toClickHouseTime(since) },
    format: 'JSONEachRow',
  })
  const [row] = await result.json<{ people: string }>()
  return Number(row?.people ?? 0)
}

export interface ErrorTotals {
  events: number
  /** Issues with at least one event in the period. */
  issues: number
  people: number
}

export async function errorTotals(
  client: ClickHouseClient,
  scope: ErrorScope,
): Promise<ErrorTotals> {
  if (scope.projectIds.length === 0) return { events: 0, issues: 0, people: 0 }
  const result = await client.query({
    query: `SELECT count() AS events, uniq(issue_id) AS issues, uniq(${PERSON}) AS people
      FROM errors WHERE ${IN_SCOPE}`,
    query_params: scopeParams(scope),
    format: 'JSONEachRow',
  })
  const [row] = await result.json<{ events: string; issues: string; people: string }>()
  return {
    events: Number(row?.events ?? 0),
    issues: Number(row?.issues ?? 0),
    people: Number(row?.people ?? 0),
  }
}

export interface ErrorPoint {
  at: Date
  events: number
  issues: number
  people: number
}

/** Events per hour or day, empty buckets filled, cut in the scope's time zone. */
export async function errorSeries(
  client: ClickHouseClient,
  scope: ErrorScope,
  bucket: Bucket,
  issueId?: string,
): Promise<ErrorPoint[]> {
  if (scope.projectIds.length === 0) return []
  const { start, step } = bucketSql(bucket)
  const result = await client.query({
    query: `
      SELECT ${start}(timestamp, {tz:String}) AS at, count() AS events,
        uniq(issue_id) AS issues, uniq(${PERSON}) AS people
      FROM errors
      WHERE ${IN_SCOPE} ${issueId ? 'AND issue_id = {issue:UUID}' : ''}
      GROUP BY at
      ORDER BY at
      WITH FILL
        FROM ${start}(toDateTime({from:DateTime64(3, 'UTC')}, 'UTC'), {tz:String})
        TO toDateTime({to:DateTime64(3, 'UTC')}, 'UTC')
        STEP ${step}`,
    query_params: { ...scopeParams(scope), issue: issueId ?? '' },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ at: string; events: string; issues: string; people: string }>()
  return rows.map((row) => ({
    at: new Date(row.at),
    events: Number(row.events),
    issues: Number(row.issues),
    people: Number(row.people),
  }))
}

export interface IssueStats {
  events: number
  people: number
  /** The source of the latest event. */
  source: string
  /** Events per bucket of the period, oldest first, `buckets` long. */
  spark: number[]
}

/**
 * Events, people and a small histogram per issue in a period: the list's
 * "Last 24 h", "Events" and "People" columns. The period is cut in `buckets`
 * equal slices.
 */
export async function issueStats(
  client: ClickHouseClient,
  scope: ErrorScope,
  buckets = 24,
): Promise<Map<string, IssueStats>> {
  const stats = new Map<string, IssueStats>()
  if (scope.projectIds.length === 0) return stats
  const width = Math.max(1, Math.ceil((scope.to.getTime() - scope.from.getTime()) / buckets))
  const result = await client.query({
    query: `
      SELECT toString(issue_id) AS issue,
        intDiv(toUnixTimestamp64Milli(timestamp) - {fromMs:Int64}, {width:Int64}) AS slot,
        count() AS events
      FROM errors WHERE ${IN_SCOPE}
      GROUP BY issue, slot`,
    query_params: { ...scopeParams(scope), fromMs: scope.from.getTime(), width },
    format: 'JSONEachRow',
  })
  // People need a distinct count over the whole period, not per slot.
  const people = await client.query({
    query: `SELECT toString(issue_id) AS issue, uniq(${PERSON}) AS people,
        toString(argMax(source_id, timestamp)) AS source
      FROM errors WHERE ${IN_SCOPE} GROUP BY issue`,
    query_params: scopeParams(scope),
    format: 'JSONEachRow',
  })
  for (const row of await result.json<{ issue: string; slot: string; events: string }>()) {
    const entry = stats.get(row.issue) ?? {
      events: 0,
      people: 0,
      source: '',
      spark: Array(buckets).fill(0),
    }
    const slot = Math.min(buckets - 1, Math.max(0, Number(row.slot)))
    entry.spark[slot] += Number(row.events)
    entry.events += Number(row.events)
    stats.set(row.issue, entry)
  }
  for (const row of await people.json<{ issue: string; people: string; source: string }>()) {
    const entry = stats.get(row.issue)
    if (entry) {
      entry.people = Number(row.people)
      entry.source = row.source
    }
  }
  return stats
}

export interface Share {
  value: string
  events: number
  /** Of the issue's events in the period, 0 to 1. */
  share: number
}

export type IssueFacet = 'browser' | 'os' | 'release' | 'path' | 'country' | 'environment'

const FACETS: Record<IssueFacet, string> = {
  browser: 'browser',
  os: 'os',
  release: 'release',
  path: 'path',
  country: 'country',
  environment: 'environment',
}

/** "Who it hits": the top values of a few fields among an issue's events. */
export async function issueFacets(
  client: ClickHouseClient,
  scope: ErrorScope,
  issueId: string,
  facets: IssueFacet[] = ['browser', 'release', 'path', 'country'],
  limit = 5,
): Promise<Record<IssueFacet, Share[]>> {
  const out = {} as Record<IssueFacet, Share[]>
  const queries = facets.map(async (facet) => {
    const result = await client.query({
      query: `
        SELECT ${FACETS[facet]} AS value, count() AS events,
          count() / sum(count()) OVER () AS share
        FROM errors WHERE ${IN_SCOPE} AND issue_id = {issue:UUID}
        GROUP BY value ORDER BY events DESC LIMIT {limit:UInt32}`,
      query_params: { ...scopeParams(scope), issue: issueId, limit },
      format: 'JSONEachRow',
    })
    out[facet] = (await result.json<{ value: string; events: string; share: number }>()).map(
      (row) => ({ value: row.value, events: Number(row.events), share: Number(row.share) }),
    )
  })
  await Promise.all(queries)
  return out
}

export interface ErrorEvent extends Omit<ErrorRow, 'exception' | 'breadcrumbs' | 'tags'> {
  exception: ErrorException[]
  breadcrumbs: ErrorBreadcrumb[]
  tags: Record<string, string>
  /** The event before this one of the same issue, for "Previous event". */
  previous: string | null
}

/** One event of an issue: the newest, or the one named. */
export async function issueEvent(
  client: ClickHouseClient,
  orgId: string,
  issueId: string,
  eventId?: string,
): Promise<ErrorEvent | null> {
  const result = await client.query({
    query: `
      SELECT *, toString(org_id) AS org_id, toString(project_id) AS project_id,
        toString(source_id) AS source_id, toString(issue_id) AS issue_id
      FROM errors
      WHERE org_id = {org:UUID} AND issue_id = {issue:UUID}
        ${eventId ? 'AND event_id = {event:String}' : ''}
      ORDER BY timestamp DESC LIMIT 1`,
    query_params: { org: orgId, issue: issueId, event: eventId ?? '' },
    // The string aliases must not replace the UUID columns in WHERE.
    clickhouse_settings: { ...ISO_TIMES, prefer_column_name_to_alias: 1 },
    format: 'JSONEachRow',
  })
  const [row] = await result.json<ErrorRow>()
  if (!row) return null
  const previous = await client.query({
    query: `
      SELECT event_id FROM errors
      WHERE org_id = {org:UUID} AND issue_id = {issue:UUID}
        AND timestamp < {at:DateTime64(3, 'UTC')}
      ORDER BY timestamp DESC LIMIT 1`,
    query_params: {
      org: orgId,
      issue: issueId,
      at: row.timestamp.replace('T', ' ').replace('Z', ''),
    },
    format: 'JSONEachRow',
  })
  const [before] = await previous.json<{ event_id: string }>()
  const parse = <T>(text: string, fallback: T): T => {
    try {
      return JSON.parse(text) as T
    } catch {
      return fallback
    }
  }
  return {
    ...row,
    exception: parse<ErrorException[]>(row.exception, []),
    breadcrumbs: parse<ErrorBreadcrumb[]>(row.breadcrumbs, []),
    tags: parse<Record<string, string>>(row.tags, {}),
    previous: before?.event_id ?? null,
  }
}

/** How many errors a product had in the last window, against its normal for this hour. */
export interface ErrorRate {
  orgId: string
  projectId: string
  /** Events in the window that ends now. */
  count: number
  /**
   * Events in a window of the same length at this time of day, averaged over
   * the last 7 days (the hour around now on each day, scaled to the window).
   */
  normal: number
  /** The issues with the most events in the window, most first. */
  top: { issueId: string; count: number }[]
}

const DAY_S = 86_400
const HALF_HOUR_S = 1_800

/**
 * The error rate of each product, for the Error spike rule. Events of the
 * issues in `skip` (ignored ones) never count. Reads only the products asked
 * for, by the table's sort key.
 */
export async function errorRates(
  client: ClickHouseClient,
  products: { orgId: string; projectId: string }[],
  at: Date,
  windowMinutes: number,
  skip: string[] = [],
): Promise<ErrorRate[]> {
  if (products.length === 0) return []
  const params = {
    orgs: [...new Set(products.map((p) => p.orgId))],
    projects: [...new Set(products.map((p) => p.projectId))],
    skip,
    at: toClickHouseTime(at),
    from: toClickHouseTime(new Date(at.getTime() - windowMinutes * 60_000)),
    since: toClickHouseTime(new Date(at.getTime() - (7 * DAY_S + HALF_HOUR_S) * 1000)),
    until: toClickHouseTime(new Date(at.getTime() - (DAY_S - HALF_HOUR_S) * 1000)),
  }
  const where = `org_id IN {orgs:Array(UUID)} AND project_id IN {projects:Array(UUID)}
    AND NOT has({skip:Array(UUID)}, issue_id)`
  // Seconds from the event to the same time of day as now, on its own day.
  const offset = `(toUnixTimestamp({at:DateTime64(3, 'UTC')}) - toUnixTimestamp(timestamp)) % ${DAY_S}`
  const before = `timestamp >= {since:DateTime64(3, 'UTC')} AND timestamp < {until:DateTime64(3, 'UTC')}
    AND (${offset} <= ${HALF_HOUR_S} OR ${offset} >= ${DAY_S - HALF_HOUR_S})`
  const [rates, top] = await Promise.all([
    client
      .query({
        query: `SELECT toString(org_id) AS org, toString(project_id) AS project,
            countIf(timestamp >= {from:DateTime64(3, 'UTC')} AND timestamp <= {at:DateTime64(3, 'UTC')}) AS count,
            countIf(${before}) AS before
          FROM errors
          WHERE ${where} AND timestamp >= {since:DateTime64(3, 'UTC')}
          GROUP BY org_id, project_id`,
        query_params: params,
        format: 'JSONEachRow',
      })
      .then((r) => r.json<{ org: string; project: string; count: string; before: string }>()),
    client
      .query({
        query: `SELECT toString(project_id) AS project, toString(issue_id) AS issue, count() AS count
          FROM errors
          WHERE ${where} AND timestamp >= {from:DateTime64(3, 'UTC')} AND timestamp <= {at:DateTime64(3, 'UTC')}
          GROUP BY project_id, issue_id
          ORDER BY count DESC
          LIMIT 3 BY project_id`,
        query_params: params,
        format: 'JSONEachRow',
      })
      .then((r) => r.json<{ project: string; issue: string; count: string }>()),
  ])
  return products.map((p) => {
    const row = rates.find((r) => r.org === p.orgId && r.project === p.projectId)
    // 7 hours of history (one per day) scaled to the window.
    const normal = (Number(row?.before ?? 0) / 7) * (windowMinutes / 60)
    return {
      orgId: p.orgId,
      projectId: p.projectId,
      count: Number(row?.count ?? 0),
      normal,
      top: top
        .filter((t) => t.project === p.projectId)
        .map((t) => ({ issueId: t.issue, count: Number(t.count) })),
    }
  })
}

/** The newest error of one source in the last day: Set up Errors waits for it. */
export async function lastError(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  sourceId: string,
): Promise<{ at: Date; type: string; value: string; issueId: string } | null> {
  const result = await client.query({
    query: `SELECT toString(timestamp) AS at, type, value, toString(issue_id) AS issue
      FROM errors
      WHERE org_id = {org:UUID} AND project_id = {project:UUID} AND source_id = {source:UUID}
        AND timestamp >= now() - INTERVAL 1 DAY
      ORDER BY timestamp DESC
      LIMIT 1`,
    query_params: { org: orgId, project: projectId, source: sourceId },
    format: 'JSONEachRow',
  })
  const [row] = await result.json<{ at: string; type: string; value: string; issue: string }>()
  return row
    ? {
        at: new Date(`${row.at.replace(' ', 'T')}Z`),
        type: row.type,
        value: row.value,
        issueId: row.issue,
      }
    : null
}

/** Errors and issues hit per product in the scope, for the Overview table. */
export async function errorsByProduct(
  client: ClickHouseClient,
  scope: ErrorScope,
): Promise<Map<string, { events: number; issues: number }>> {
  if (scope.projectIds.length === 0) return new Map()
  const result = await client.query({
    query: `SELECT toString(project_id) AS project, count() AS events, uniq(issue_id) AS issues
      FROM errors WHERE ${IN_SCOPE}
      GROUP BY project_id`,
    query_params: scopeParams(scope),
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ project: string; events: string; issues: string }>()
  return new Map(
    rows.map((row) => [row.project, { events: Number(row.events), issues: Number(row.issues) }]),
  )
}
