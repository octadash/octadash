import type { ClickHouseClient } from '@clickhouse/client'
import { toClickHouseTime } from './events'

/**
 * Traffic queries. Each takes the organization and a list of products, or
 * null for all of them, so the same query serves All products, a group and
 * one product. Bots are left out of every number except `bots`.
 */

export interface TrafficScope {
  orgId: string
  /** Null: every product of the organization. An empty list matches nothing. */
  projectIds: string[] | null
  from: Date
  to: Date
}

/** A person: the id the app gave them, else the daily hash. */
const VISITOR = `if(distinct_id != '', distinct_id, visitor_id)`
const PAGEVIEW = `event = '$pageview'`

function where(scope: TrafficScope) {
  return `org_id = {org:UUID}
    ${scope.projectIds ? 'AND project_id IN {projects:Array(UUID)}' : ''}
    AND timestamp >= {from:DateTime64(3, 'UTC')}
    AND timestamp < {to:DateTime64(3, 'UTC')}`
}

function params(scope: TrafficScope) {
  return {
    org: scope.orgId,
    projects: scope.projectIds ?? [],
    from: toClickHouseTime(scope.from),
    to: toClickHouseTime(scope.to),
  }
}

export interface TrafficSummary {
  pageviews: number
  visitors: number
  /** Visits by bots in the period, kept apart. */
  bots: number
}

export async function trafficSummary(
  client: ClickHouseClient,
  scope: TrafficScope,
): Promise<TrafficSummary> {
  if (scope.projectIds?.length === 0) return { pageviews: 0, visitors: 0, bots: 0 }
  const result = await client.query({
    query: `
      SELECT
        countIf(is_bot = 0) AS pageviews,
        uniqIf(${VISITOR}, is_bot = 0) AS visitors,
        countIf(is_bot = 1) AS bots
      FROM events
      WHERE ${where(scope)} AND ${PAGEVIEW}`,
    query_params: params(scope),
    format: 'JSONEachRow',
  })
  const [row] = await result.json<{ pageviews: string; visitors: string; bots: string }>()
  return {
    pageviews: Number(row?.pageviews ?? 0),
    visitors: Number(row?.visitors ?? 0),
    bots: Number(row?.bots ?? 0),
  }
}

export interface TrafficPoint {
  /** Start of the bucket. */
  at: Date
  pageviews: number
  visitors: number
}

/** Page views and visitors per hour or per day, with empty buckets filled. */
export async function trafficSeries(
  client: ClickHouseClient,
  scope: TrafficScope,
  bucket: 'hour' | 'day',
): Promise<TrafficPoint[]> {
  if (scope.projectIds?.length === 0) return []
  const unit = bucket === 'hour' ? 'toStartOfHour' : 'toStartOfDay'
  const step = bucket === 'hour' ? 3600 : 86400
  const result = await client.query({
    query: `
      SELECT
        ${unit}(timestamp) AS at,
        count() AS pageviews,
        uniq(${VISITOR}) AS visitors
      FROM events
      WHERE ${where(scope)} AND ${PAGEVIEW} AND is_bot = 0
      GROUP BY at
      ORDER BY at
      WITH FILL
        FROM ${unit}(toDateTime({from:DateTime64(3, 'UTC')}, 'UTC'))
        TO toDateTime({to:DateTime64(3, 'UTC')}, 'UTC')
        STEP ${step}`,
    query_params: params(scope),
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ at: string; pageviews: string; visitors: string }>()
  return rows.map((row) => ({
    at: new Date(`${row.at.replace(' ', 'T')}Z`),
    pageviews: Number(row.pageviews),
    visitors: Number(row.visitors),
  }))
}

/** What a breakdown can group by. `source` is the UTM source, else the referring site. */
export const TRAFFIC_DIMENSIONS = {
  page: 'path',
  source: `if(utm_source != '', utm_source, referrer_host)`,
  campaign: 'utm_campaign',
  browser: 'browser',
  os: 'os',
  device: 'device',
  country: 'country',
  product: 'toString(project_id)',
} as const

export type TrafficDimension = keyof typeof TRAFFIC_DIMENSIONS

export interface TrafficRow {
  /** Empty means unknown: direct visits for `source`, no proxy header for `country`. */
  value: string
  pageviews: number
  visitors: number
}

/** Top values of one dimension, by visitors. */
export async function trafficBreakdown(
  client: ClickHouseClient,
  scope: TrafficScope,
  dimension: TrafficDimension,
  limit = 10,
): Promise<TrafficRow[]> {
  if (scope.projectIds?.length === 0) return []
  const expression = TRAFFIC_DIMENSIONS[dimension]
  const result = await client.query({
    query: `
      SELECT
        ${expression} AS value,
        count() AS pageviews,
        uniq(${VISITOR}) AS visitors
      FROM events
      WHERE ${where(scope)} AND ${PAGEVIEW} AND is_bot = 0
      GROUP BY value
      ORDER BY visitors DESC, pageviews DESC, value
      LIMIT {limit:UInt32}`,
    query_params: { ...params(scope), limit },
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ value: string; pageviews: string; visitors: string }>()
  return rows.map((row) => ({
    value: row.value,
    pageviews: Number(row.pageviews),
    visitors: Number(row.visitors),
  }))
}
