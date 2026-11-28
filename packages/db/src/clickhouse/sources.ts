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
