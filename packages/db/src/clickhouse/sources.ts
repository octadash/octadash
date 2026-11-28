import type { ClickHouseClient } from '@clickhouse/client'
import { ISO_TIMES } from './buckets'
import { toClickHouseTime } from './events'

export interface SourceActivity {
  /** When the source last sent anything, in the last 30 days. */
  last: Date | null
  /** Page views in the last 24 hours (Traffic). */
  pageviews: number
  /** Other events in the last 24 hours (Product usage). */
  events: number
}

/**
 * What each source of a product sent: its last data in 30 days and its counts
 * of the last 24 hours, per area. Sources that sent nothing are left out.
 */
export async function sourceActivity(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  now = new Date(),
): Promise<Map<string, SourceActivity>> {
  const result = await client.query({
    query: `
      SELECT toString(source_id) AS source,
        max(received_at) AS last,
        countIf(event = '$pageview' AND received_at >= {day:DateTime64(3, 'UTC')}) AS pageviews,
        countIf(event NOT IN ('$pageview', '$pageleave') AND received_at >= {day:DateTime64(3, 'UTC')}) AS events
      FROM events
      WHERE org_id = {org:UUID} AND project_id = {project:UUID}
        AND timestamp >= {month:DateTime64(3, 'UTC')}
      GROUP BY source_id`,
    query_params: {
      org: orgId,
      project: projectId,
      day: toClickHouseTime(new Date(now.getTime() - 86_400_000)),
      month: toClickHouseTime(new Date(now.getTime() - 30 * 86_400_000)),
    },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{
    source: string
    last: string
    pageviews: string
    events: string
  }>()
  return new Map(
    rows.map((row) => [
      row.source,
      {
        last: row.last ? new Date(row.last) : null,
        pageviews: Number(row.pageviews),
        events: Number(row.events),
      },
    ]),
  )
}

/** When a source last sent each kind of data; `any` is the newest of them. */
export interface SourceLastData {
  any: Date
  pageview?: Date
  event?: Date
  error?: Date
  log?: Date
}

/**
 * When each source of these products last sent each kind of data (page
 * views, other events, errors, logs) since a time. The empty pages use it to
 * tell a source that never sent from one gone silent, and a real zero from
 * silence. Sources that sent nothing are left out.
 */
export async function sourcesLastData(
  client: ClickHouseClient,
  orgId: string,
  projectIds: string[],
  since: Date,
): Promise<Map<string, SourceLastData>> {
  if (projectIds.length === 0) return new Map()
  const where = `org_id = {org:UUID} AND project_id IN {projects:Array(UUID)}
    AND timestamp >= {since:DateTime64(3, 'UTC')}`
  const result = await client.query({
    query: `
      SELECT toString(source_id) AS source,
        if(event = '$pageview', 'pageview', 'event') AS kind, max(received_at) AS last
        FROM events WHERE ${where} AND event != '$pageleave' GROUP BY source_id, kind
      UNION ALL
      SELECT toString(source_id), 'error', max(received_at)
        FROM errors WHERE ${where} GROUP BY source_id
      UNION ALL
      SELECT toString(source_id), 'log', toDateTime64(max(timestamp), 3, 'UTC')
        FROM logs WHERE ${where} GROUP BY source_id`,
    query_params: { org: orgId, projects: projectIds, since: toClickHouseTime(since) },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ source: string; kind: string; last: string }>()
  const out = new Map<string, SourceLastData>()
  for (const row of rows) {
    const at = new Date(row.last)
    const seen = out.get(row.source) ?? { any: at }
    if (at > seen.any) seen.any = at
    if (
      row.kind === 'pageview' ||
      row.kind === 'event' ||
      row.kind === 'error' ||
      row.kind === 'log'
    )
      seen[row.kind] = at
    out.set(row.source, seen)
  }
  return out
}
