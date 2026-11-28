import type { ClickHouseClient } from '@clickhouse/client'
import { type Bucket, bucketSql, ISO_TIMES } from './buckets'
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
  /** IANA zone that day buckets follow ("America/Sao_Paulo"). Default UTC. */
  timeZone?: string
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
    tz: scope.timeZone ?? 'UTC',
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

/**
 * Page views and visitors per hour or per day, with empty buckets filled. Days
 * start at midnight in the scope's time zone.
 */
export async function trafficSeries(
  client: ClickHouseClient,
  scope: TrafficScope,
  bucket: Bucket,
): Promise<TrafficPoint[]> {
  if (scope.projectIds?.length === 0) return []
  const { start, step } = bucketSql(bucket)
  const result = await client.query({
    query: `
      SELECT
        ${start}(timestamp, {tz:String}) AS at,
        count() AS pageviews,
        uniq(${VISITOR}) AS visitors
      FROM events
      WHERE ${where(scope)} AND ${PAGEVIEW} AND is_bot = 0
      GROUP BY at
      ORDER BY at
      WITH FILL
        FROM ${start}(toDateTime({from:DateTime64(3, 'UTC')}, 'UTC'), {tz:String})
        TO toDateTime({to:DateTime64(3, 'UTC')}, 'UTC')
        STEP ${step}`,
    query_params: params(scope),
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ at: string; pageviews: string; visitors: string }>()
  return rows.map((row) => ({
    at: new Date(row.at),
    pageviews: Number(row.pageviews),
    visitors: Number(row.visitors),
  }))
}

/**
 * The same series split by product, for a sparkline per row. Buckets without
 * visits are left out; `fillSeries` puts them back from the scope's series.
 */
export async function trafficSeriesByProduct(
  client: ClickHouseClient,
  scope: TrafficScope,
  bucket: Bucket,
): Promise<Map<string, TrafficPoint[]>> {
  const series = new Map<string, TrafficPoint[]>()
  if (scope.projectIds?.length === 0) return series
  const { start } = bucketSql(bucket)
  const result = await client.query({
    query: `
      SELECT
        toString(project_id) AS product,
        ${start}(timestamp, {tz:String}) AS at,
        count() AS pageviews,
        uniq(${VISITOR}) AS visitors
      FROM events
      WHERE ${where(scope)} AND ${PAGEVIEW} AND is_bot = 0
      GROUP BY product, at
      ORDER BY product, at`,
    query_params: params(scope),
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{
    product: string
    at: string
    pageviews: string
    visitors: string
  }>()
  for (const row of rows) {
    const points = series.get(row.product) ?? []
    points.push({
      at: new Date(row.at),
      pageviews: Number(row.pageviews),
      visitors: Number(row.visitors),
    })
    series.set(row.product, points)
  }
  return series
}

/** Puts back the empty buckets of a sparse series, taking the buckets from a full one. */
export function fillSeries(sparse: TrafficPoint[], buckets: Date[]): TrafficPoint[] {
  const byTime = new Map(sparse.map((point) => [point.at.getTime(), point]))
  return buckets.map((at) => byTime.get(at.getTime()) ?? { at, pageviews: 0, visitors: 0 })
}

/** People with a page view in the last few minutes: "N online now". */
export async function onlineNow(
  client: ClickHouseClient,
  scope: Pick<TrafficScope, 'orgId' | 'projectIds'>,
  at: Date,
  minutes = 5,
): Promise<number> {
  const from = new Date(at.getTime() - minutes * 60_000)
  return (await trafficSummary(client, { ...scope, from, to: at })).visitors
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
