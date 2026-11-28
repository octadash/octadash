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
  /** "Source is Google and country is BR": every number of the page follows them. */
  filters?: TrafficFilter[]
}

/** One filter of the Traffic page: a row someone clicked. */
export interface TrafficFilter {
  dimension: TrafficFilterDimension
  value: string
}

/** A person: the id the app gave them, else the daily hash. */
const VISITOR = `if(distinct_id != '', distinct_id, visitor_id)`
const PAGEVIEW = `event = '$pageview'`

/** The product and time part, without filters: what "first page of the day" is read from. */
function base(scope: TrafficScope) {
  return `org_id = {org:UUID}
    ${scope.projectIds ? 'AND project_id IN {projects:Array(UUID)}' : ''}
    AND timestamp >= {from:DateTime64(3, 'UTC')}
    AND timestamp < {to:DateTime64(3, 'UTC')}`
}

/**
 * Dimensions read from the first page view of each visit, so a visit that came
 * from Google stays Google on its next pages (whose referrer is the site
 * itself). The script keeps no session, so a visit is a visitor's day.
 */
const VISIT_DIMENSIONS = new Set<TrafficDimension>(['entry', 'channel', 'source', 'campaign'])

function columnOf(dimension: TrafficDimension) {
  return dimension === 'entry' ? 'path' : TRAFFIC_DIMENSIONS[dimension]
}

/** Each visit (visitor and day) with the value of `dimension` on its first page view. */
const VISITS = (scope: TrafficScope, dimension: TrafficDimension) => `
  SELECT ${VISITOR} AS v, toDate(timestamp, {tz:String}) AS d,
    argMin(${columnOf(dimension)}, timestamp) AS origin
  FROM events
  WHERE ${base(scope)} AND ${PAGEVIEW} AND is_bot = 0
  GROUP BY v, d`

function filterSql(scope: TrafficScope) {
  return (scope.filters ?? [])
    .map((filter, i) =>
      VISIT_DIMENSIONS.has(filter.dimension)
        ? `AND (${VISITOR}, toDate(timestamp, {tz:String})) IN (
            SELECT v, d FROM (${VISITS(scope, filter.dimension)}) WHERE origin = {f${i}:String})`
        : `AND ${columnOf(filter.dimension)} = {f${i}:String}`,
    )
    .join('\n    ')
}

function where(scope: TrafficScope) {
  return `${base(scope)}
    ${filterSql(scope)}`
}

function params(scope: TrafficScope) {
  return {
    org: scope.orgId,
    projects: scope.projectIds ?? [],
    from: toClickHouseTime(scope.from),
    to: toClickHouseTime(scope.to),
    tz: scope.timeZone ?? 'UTC',
    ...Object.fromEntries((scope.filters ?? []).map((f, i) => [`f${i}`, f.value])),
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

const SITE = (hosts: string) => `match(referrer_host, '(^|[.])(${hosts})$')`

/**
 * Where a visit came from, in the groups people think in. Order matters: a
 * paid campaign from Google is Paid, Gemini is AI before google.* is Search.
 */
export const CHANNEL_SQL = `multiIf(
  match(lower(utm_medium), '^(cpc|ppc|paid|paidsearch|paid_search|paid-search|paidsocial|paid_social|paid-social|display|ads?)$'), 'paid',
  match(lower(utm_medium), 'e-?mail|newsletter') OR match(lower(utm_source), 'newsletter|e-?mail'), 'email',
  ${SITE('chatgpt[.]com|openai[.]com|perplexity[.]ai|claude[.]ai|gemini[.]google[.]com|copilot[.]microsoft[.]com|you[.]com|phind[.]com')}
    OR match(lower(utm_source), '^(chatgpt([.]com)?|openai|perplexity|claude|gemini|copilot)$'), 'ai',
  ${SITE('google[.][a-z.]+|bing[.]com|duckduckgo[.]com|search[.]yahoo[.]com|yandex[.][a-z.]+|ecosia[.]org|baidu[.]com|search[.]brave[.]com')}, 'search',
  ${SITE('facebook[.]com|fb[.]com|instagram[.]com|t[.]co|twitter[.]com|x[.]com|linkedin[.]com|lnkd[.]in|youtube[.]com|youtu[.]be|reddit[.]com|tiktok[.]com|pinterest[.][a-z.]+|threads[.]net|whatsapp[.]com|wa[.]me|bsky[.]app|news[.]ycombinator[.]com')}
    OR match(lower(utm_source), '^(facebook|fb|instagram|ig|twitter|x|linkedin|youtube|reddit|tiktok|pinterest|threads|whatsapp|bluesky)$'), 'social',
  referrer_host = '' AND utm_source = '', 'direct',
  'referral')`

const SCREEN_WIDTH = `JSONExtractUInt(properties, '$screen_width')`

/** What a breakdown can group by. `source` is the UTM source, else the referring site. */
export const TRAFFIC_DIMENSIONS = {
  page: 'path',
  channel: CHANNEL_SQL,
  source: `if(utm_source != '', utm_source, referrer_host)`,
  campaign: 'utm_campaign',
  browser: 'browser',
  os: 'os',
  device: 'device',
  /** Width of the screen in groups: phone, tablet, laptop, desktop. Empty: not sent. */
  screen: `multiIf(${SCREEN_WIDTH} = 0, '', ${SCREEN_WIDTH} < 576, 'phone', ${SCREEN_WIDTH} < 992, 'tablet', ${SCREEN_WIDTH} < 1440, 'laptop', 'desktop')`,
  country: 'country',
  product: 'toString(project_id)',
  /** The source (site, docs, app) that sent the page view: one product, several sites. */
  origin: 'toString(source_id)',
} as const

export type TrafficDimension = keyof typeof TRAFFIC_DIMENSIONS | 'entry'
export type TrafficFilterDimension = TrafficDimension

export interface TrafficRow {
  /** Empty means unknown: direct visits for `source`, no proxy header for `country`. */
  value: string
  /** For pages, with every product in scope: whose page it is. */
  product?: string
  pageviews: number
  visitors: number
}

export interface BreakdownOptions {
  limit?: number
  offset?: number
  /** Only values that contain this, any case. */
  search?: string
  /** Pages grouped per product, for All products and groups. */
  byProduct?: boolean
}

function valueExpression(dimension: TrafficDimension) {
  return VISIT_DIMENSIONS.has(dimension)
    ? 'origin'
    : TRAFFIC_DIMENSIONS[dimension as keyof typeof TRAFFIC_DIMENSIONS]
}

/** The page views a breakdown reads: for visit dimensions, each with its visit's origin. */
function rowsFor(scope: TrafficScope, dimension: TrafficDimension) {
  if (!VISIT_DIMENSIONS.has(dimension)) {
    return `events WHERE ${where(scope)} AND ${PAGEVIEW} AND is_bot = 0`
  }
  return `(
      SELECT e.*, x.origin AS origin FROM events AS e
      INNER JOIN (${VISITS(scope, dimension)}) AS x
        ON x.v = if(e.distinct_id != '', e.distinct_id, e.visitor_id)
       AND x.d = toDate(e.timestamp, {tz:String})
      WHERE ${where(scope)} AND e.${PAGEVIEW} AND e.is_bot = 0
    )`
}

/** Top values of one dimension, by visitors. */
export async function trafficBreakdown(
  client: ClickHouseClient,
  scope: TrafficScope,
  dimension: TrafficDimension,
  options: number | BreakdownOptions = 10,
): Promise<TrafficRow[]> {
  if (scope.projectIds?.length === 0) return []
  const {
    limit = 10,
    offset = 0,
    search = '',
    byProduct = false,
  } = typeof options === 'number' ? { limit: options } : options
  const expression = valueExpression(dimension)
  const perProduct = byProduct && (dimension === 'page' || dimension === 'entry')
  const result = await client.query({
    query: `
      SELECT
        ${expression} AS value,
        ${perProduct ? 'toString(project_id)' : "''"} AS product,
        count() AS pageviews,
        uniq(${VISITOR}) AS visitors
      FROM ${rowsFor(scope, dimension)}
      ${search ? `${VISIT_DIMENSIONS.has(dimension) ? 'WHERE' : 'AND'} positionCaseInsensitiveUTF8(${expression}, {search:String}) > 0` : ''}
      GROUP BY value, product
      ORDER BY visitors DESC, pageviews DESC, value
      LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
    query_params: { ...params(scope), limit, offset, search },
    format: 'JSONEachRow',
  })
  const rows = await result.json<{
    value: string
    product: string
    pageviews: string
    visitors: string
  }>()
  return rows.map((row) => ({
    value: row.value,
    ...(row.product ? { product: row.product } : {}),
    pageviews: Number(row.pageviews),
    visitors: Number(row.visitors),
  }))
}

/** How many different values a dimension has: "184 sources". Pages per product with `byProduct`. */
export async function trafficDistinct(
  client: ClickHouseClient,
  scope: TrafficScope,
  dimension: TrafficDimension,
  byProduct = false,
): Promise<number> {
  if (scope.projectIds?.length === 0) return 0
  const value = valueExpression(dimension)
  const perProduct = byProduct && (dimension === 'page' || dimension === 'entry')
  const result = await client.query({
    query: `SELECT uniq(${perProduct ? `project_id, ${value}` : value}) AS n FROM ${rowsFor(scope, dimension)}`,
    query_params: params(scope),
    format: 'JSONEachRow',
  })
  const [row] = await result.json<{ n: string }>()
  return Number(row?.n ?? 0)
}

/** How far back a visitor counts as returning. */
const RETURNING_LOOKBACK_DAYS = 90

/**
 * Visitors who had come on an earlier day, among those of sources that count
 * returning visitors (`sourceIds`: the others change their id every day, so
 * nobody would ever return). Null when no source in scope counts them.
 */
export async function trafficReturning(
  client: ClickHouseClient,
  scope: TrafficScope,
  sourceIds: string[],
): Promise<{ visitors: number; returning: number } | null> {
  if (sourceIds.length === 0 || scope.projectIds?.length === 0) return null
  const wide = {
    ...scope,
    from: new Date(scope.from.getTime() - RETURNING_LOOKBACK_DAYS * 86_400_000),
  }
  const result = await client.query({
    query: `
      SELECT count() AS visitors, countIf(earlier) AS returning
      FROM (
        SELECT
          ${VISITOR} AS v,
          toDate(min(timestamp), {tz:String}) < toDate(minIf(timestamp, timestamp >= {start:DateTime64(3, 'UTC')}), {tz:String}) AS earlier
        FROM events
        WHERE ${where(wide)} AND ${PAGEVIEW} AND is_bot = 0
          AND source_id IN {sources:Array(UUID)}
        GROUP BY v
        HAVING countIf(timestamp >= {start:DateTime64(3, 'UTC')}) > 0
      )`,
    query_params: { ...params(wide), start: toClickHouseTime(scope.from), sources: sourceIds },
    format: 'JSONEachRow',
  })
  const [row] = await result.json<{ visitors: string; returning: string }>()
  return { visitors: Number(row?.visitors ?? 0), returning: Number(row?.returning ?? 0) }
}

/** The newest page view of one source in the last day: "it works" on Set up Traffic. */
export async function lastPageview(
  client: ClickHouseClient,
  orgId: string,
  sourceId: string,
  now = new Date(),
): Promise<{ at: Date; path: string } | null> {
  const result = await client.query({
    query: `
      SELECT max(timestamp) AS at, argMax(path, timestamp) AS path, count() AS n
      FROM events
      WHERE org_id = {org:UUID} AND source_id = {source:UUID} AND ${PAGEVIEW}
        AND timestamp >= {from:DateTime64(3, 'UTC')}`,
    query_params: {
      org: orgId,
      source: sourceId,
      from: toClickHouseTime(new Date(now.getTime() - 86_400_000)),
    },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const [row] = await result.json<{ at: string; path: string; n: string }>()
  if (!row || Number(row.n) === 0) return null
  return { at: new Date(row.at), path: row.path }
}
