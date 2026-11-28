import type { ClickHouseClient } from '@clickhouse/client'
import { type Bucket, bucketSql, ISO_TIMES } from './buckets'
import { toClickHouseTime } from './events'

/**
 * Product usage queries over `events`. A product event is any event but page
 * views; a person is the id the app gave them (kept as a hash), else the
 * visitor hash of the day. Bots are left out. Every query takes the
 * organization and a list of products, so All products, a group and one
 * product are the same query.
 */

export interface UsageScope {
  orgId: string
  projectIds: string[]
  from: Date
  to: Date
  /** IANA zone that days and weeks follow. Default UTC. */
  timeZone?: string
}

/** A key event of a product, as `has()` reads it: "<project id>:<event>". */
export type KeyEventRef = { projectId: string; event: string }

const PERSON = `if(distinct_id != '', distinct_id, visitor_id)`
const PRODUCT_EVENT = `event NOT IN ('$pageview', '$pageleave') AND is_bot = 0`
const IN_SCOPE = `org_id = {org:UUID} AND project_id IN {projects:Array(UUID)}
  AND timestamp >= {from:DateTime64(3, 'UTC')} AND timestamp < {to:DateTime64(3, 'UTC')}`
const IS_KEY = `has({keys:Array(String)}, concat(toString(project_id), ':', event))`
const IS_SIGNUP = `event IN {signups:Array(String)}`

const keyRefs = (keys: KeyEventRef[]) => keys.map((k) => `${k.projectId}:${k.event}`)

function params(scope: UsageScope) {
  return {
    org: scope.orgId,
    projects: scope.projectIds,
    from: toClickHouseTime(scope.from),
    to: toClickHouseTime(scope.to),
    tz: scope.timeZone ?? 'UTC',
  }
}

export interface UsageTotals {
  /** People who did anything but view a page. */
  active: number
  signups: number
  keyEvents: number
}

const NO_TOTALS: UsageTotals = { active: 0, signups: 0, keyEvents: 0 }

/** Active people, sign-ups and key events of a period. */
export async function usageTotals(
  client: ClickHouseClient,
  scope: UsageScope,
  signups: string[],
  keys: KeyEventRef[],
): Promise<UsageTotals> {
  if (scope.projectIds.length === 0) return NO_TOTALS
  const result = await client.query({
    query: `SELECT uniqIf(${PERSON}, ${PERSON} != '') AS active,
        countIf(${IS_SIGNUP}) AS signups, countIf(${IS_KEY}) AS key_events
      FROM events WHERE ${IN_SCOPE} AND ${PRODUCT_EVENT}`,
    query_params: { ...params(scope), signups, keys: keyRefs(keys) },
    format: 'JSONEachRow',
  })
  const [row] = await result.json<{ active: string; signups: string; key_events: string }>()
  return {
    active: Number(row?.active ?? 0),
    signups: Number(row?.signups ?? 0),
    keyEvents: Number(row?.key_events ?? 0),
  }
}

/** Sign-ups per product in a period, for the Overview's table. */
export async function signupsByProduct(
  client: ClickHouseClient,
  scope: UsageScope,
  signups: string[],
): Promise<Map<string, number>> {
  if (scope.projectIds.length === 0) return new Map()
  const result = await client.query({
    query: `SELECT toString(project_id) AS project, count() AS signups
      FROM events WHERE ${IN_SCOPE} AND ${PRODUCT_EVENT} AND ${IS_SIGNUP}
      GROUP BY project`,
    query_params: { ...params(scope), signups },
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ project: string; signups: string }>()
  return new Map(rows.map((r) => [r.project, Number(r.signups)]))
}

export interface UsagePoint extends UsageTotals {
  at: Date
}

/** The totals per hour or day, empty buckets filled; days follow the scope's zone. */
export async function usageSeries(
  client: ClickHouseClient,
  scope: UsageScope,
  bucket: Bucket,
  signups: string[],
  keys: KeyEventRef[],
): Promise<UsagePoint[]> {
  if (scope.projectIds.length === 0) return []
  const { start, step } = bucketSql(bucket)
  const result = await client.query({
    query: `
      SELECT ${start}(timestamp, {tz:String}) AS at,
        uniqIf(${PERSON}, ${PERSON} != '') AS active,
        countIf(${IS_SIGNUP}) AS signups, countIf(${IS_KEY}) AS key_events
      FROM events WHERE ${IN_SCOPE} AND ${PRODUCT_EVENT}
      GROUP BY at
      ORDER BY at
      WITH FILL
        FROM ${start}(toDateTime({from:DateTime64(3, 'UTC')}, 'UTC'), {tz:String})
        TO toDateTime({to:DateTime64(3, 'UTC')}, 'UTC')
        STEP ${step}`,
    query_params: { ...params(scope), signups, keys: keyRefs(keys) },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{
    at: string
    active: string
    signups: string
    key_events: string
  }>()
  return rows.map((row) => ({
    at: new Date(row.at),
    active: Number(row.active),
    signups: Number(row.signups),
    keyEvents: Number(row.key_events),
  }))
}

export interface UsageEventRow {
  projectId: string
  event: string
  count: number
  people: number
  /** The count in each baseline period, in the order given. */
  baseline: number[]
  /** The newest one in the period. */
  last: Date | null
}

/**
 * Each event the products sent in a period, with its people and its count in
 * earlier periods of the same length (the baselines), from which the list
 * reads what is normal. Events named by the SDKs (`$...`) are left out.
 */
export async function usageEvents(
  client: ClickHouseClient,
  scope: UsageScope,
  baselines: { from: Date; to: Date }[] = [],
  limit = 200,
): Promise<UsageEventRow[]> {
  if (scope.projectIds.length === 0) return []
  const earliest = new Date(
    Math.min(scope.from.getTime(), ...baselines.map((b) => b.from.getTime())),
  )
  const inPeriod = `timestamp >= {from:DateTime64(3, 'UTC')} AND timestamp < {to:DateTime64(3, 'UTC')}`
  const baselineSql = baselines
    .map(
      (_, i) =>
        `countIf(timestamp >= {b${i}from:DateTime64(3, 'UTC')} AND timestamp < {b${i}to:DateTime64(3, 'UTC')}) AS b${i}`,
    )
    .join(', ')
  const result = await client.query({
    query: `SELECT toString(project_id) AS project, event,
        countIf(${inPeriod}) AS count,
        uniqIf(${PERSON}, ${inPeriod} AND ${PERSON} != '') AS people,
        maxIf(timestamp, ${inPeriod}) AS last
        ${baselineSql ? `, ${baselineSql}` : ''}
      FROM events
      WHERE org_id = {org:UUID} AND project_id IN {projects:Array(UUID)}
        AND timestamp >= {earliest:DateTime64(3, 'UTC')} AND timestamp < {to:DateTime64(3, 'UTC')}
        AND ${PRODUCT_EVENT} AND NOT startsWith(event, '$')
      GROUP BY project_id, event
      ORDER BY count DESC, event
      LIMIT {limit:UInt32}`,
    query_params: {
      ...params(scope),
      earliest: toClickHouseTime(earliest),
      limit,
      ...Object.fromEntries(
        baselines.flatMap((b, i) => [
          [`b${i}from`, toClickHouseTime(b.from)],
          [`b${i}to`, toClickHouseTime(b.to)],
        ]),
      ),
    },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<Record<string, string>>()
  return rows.map((row) => ({
    projectId: row.project ?? '',
    event: row.event ?? '',
    count: Number(row.count ?? 0),
    people: Number(row.people ?? 0),
    baseline: baselines.map((_, i) => Number(row[`b${i}`] ?? 0)),
    last: Number(row.count ?? 0) > 0 && row.last ? new Date(row.last) : null,
  }))
}

export interface CameBack {
  /** People who signed up in the week before the period. */
  people: number
  /** Of them, the ones who did anything in their second week. */
  returned: number
}

/**
 * "Came back week 1": of the people who signed up 7 days before the period,
 * how many did anything 7 to 14 days after signing up. Needs the app to tie
 * events to a person (identify); a visitor hash changes every day.
 */
export async function cameBackWeek1(
  client: ClickHouseClient,
  scope: UsageScope,
  signups: string[],
): Promise<CameBack> {
  if (scope.projectIds.length === 0) return { people: 0, returned: 0 }
  const WEEK = 7 * 86_400_000
  const result = await client.query({
    query: `
      WITH signed AS (
        SELECT project_id, ${PERSON} AS p, min(timestamp) AS t
        FROM events
        WHERE org_id = {org:UUID} AND project_id IN {projects:Array(UUID)}
          AND timestamp >= {sfrom:DateTime64(3, 'UTC')} AND timestamp < {sto:DateTime64(3, 'UTC')}
          AND ${IS_SIGNUP} AND distinct_id != '' AND is_bot = 0
        GROUP BY project_id, p
      )
      SELECT count() AS people, sum(back) AS returned FROM (
        SELECT s.project_id, s.p,
          max(e.timestamp >= s.t + INTERVAL 7 DAY AND e.timestamp < s.t + INTERVAL 14 DAY) AS back
        FROM signed AS s
        LEFT JOIN (
          SELECT project_id, ${PERSON} AS p, timestamp FROM events
          WHERE org_id = {org:UUID} AND project_id IN {projects:Array(UUID)}
            AND timestamp >= {from:DateTime64(3, 'UTC')} AND timestamp < {eto:DateTime64(3, 'UTC')}
            AND ${PRODUCT_EVENT} AND distinct_id != ''
        ) AS e ON e.project_id = s.project_id AND e.p = s.p
        GROUP BY s.project_id, s.p
      )`,
    query_params: {
      ...params(scope),
      signups,
      sfrom: toClickHouseTime(new Date(scope.from.getTime() - WEEK)),
      sto: toClickHouseTime(new Date(scope.to.getTime() - WEEK)),
      eto: toClickHouseTime(new Date(scope.to.getTime() + WEEK)),
    },
    clickhouse_settings: { join_use_nulls: 0 },
    format: 'JSONEachRow',
  })
  const [row] = await result.json<{ people: string; returned: string | null }>()
  return { people: Number(row?.people ?? 0), returned: Number(row?.returned ?? 0) }
}

export interface Cohort {
  /** Monday the people signed up in, in the scope's zone (YYYY-MM-DD). */
  week: string
  people: number
  /** People active in week 0, 1, 2…; week 0 is everyone. */
  active: number[]
}

/**
 * "Who comes back": people by the week they signed up, and how many did
 * anything in each week after. Covers the whole weeks among the last `weeks`
 * up to the scope's end.
 */
export async function retentionCohorts(
  client: ClickHouseClient,
  scope: Omit<UsageScope, 'from'>,
  signups: string[],
  weeks = 6,
): Promise<Cohort[]> {
  if (scope.projectIds.length === 0) return []
  const since = new Date(scope.to.getTime() - weeks * 7 * 86_400_000)
  const result = await client.query({
    query: `
      WITH signed AS (
        SELECT project_id, ${PERSON} AS p,
          toStartOfWeek(min(timestamp), 1, {tz:String}) AS w
        FROM events
        WHERE org_id = {org:UUID} AND project_id IN {projects:Array(UUID)}
          AND timestamp >= {from:DateTime64(3, 'UTC')} AND timestamp < {to:DateTime64(3, 'UTC')}
          AND ${IS_SIGNUP} AND distinct_id != '' AND is_bot = 0
        GROUP BY project_id, p
        -- The first week is cut by the start of the range: only whole weeks.
        HAVING w > toStartOfWeek(toDateTime({from:DateTime64(3, 'UTC')}, 'UTC'), 1, {tz:String})
      )
      SELECT toString(s.w) AS week,
        dateDiff('week', s.w, toStartOfWeek(e.timestamp, 1, {tz:String})) AS k,
        uniqExact(s.project_id, s.p) AS n
      FROM signed AS s
      INNER JOIN (
        SELECT project_id, ${PERSON} AS p, timestamp FROM events
        WHERE org_id = {org:UUID} AND project_id IN {projects:Array(UUID)}
          AND timestamp >= {from:DateTime64(3, 'UTC')} AND timestamp < {to:DateTime64(3, 'UTC')}
          AND ${PRODUCT_EVENT} AND distinct_id != ''
      ) AS e ON e.project_id = s.project_id AND e.p = s.p
      GROUP BY week, k
      HAVING k >= 0 AND k < {weeks:UInt8}
      ORDER BY week, k`,
    query_params: { ...params({ ...scope, from: since }), signups, weeks },
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ week: string; k: string; n: string }>()
  const cohorts = new Map<string, number[]>()
  for (const row of rows) {
    const active = cohorts.get(row.week) ?? []
    active[Number(row.k)] = Number(row.n)
    cohorts.set(row.week, active)
  }
  return [...cohorts.entries()].map(([week, active]) => {
    const filled = Array.from({ length: active.length }, (_, i) => active[i] ?? 0)
    return { week, people: filled[0] ?? 0, active: filled }
  })
}

/**
 * People who reached each step of a funnel, in order, within `windowDays` of
 * their first step (ClickHouse's windowFunnel). Step 1 counts everyone who
 * did it in the period.
 */
export async function funnelSteps(
  client: ClickHouseClient,
  scope: UsageScope,
  steps: string[],
  windowDays: number,
): Promise<number[]> {
  if (scope.projectIds.length === 0 || steps.length === 0) return steps.map(() => 0)
  const conditions = steps.map((_, i) => `event = {s${i}:String}`).join(', ')
  const result = await client.query({
    query: `SELECT level, count() AS n FROM (
        SELECT ${PERSON} AS p,
          windowFunnel({window:UInt64})(toDateTime(timestamp), ${conditions}) AS level
        FROM events
        WHERE ${IN_SCOPE} AND event IN {steps:Array(String)} AND is_bot = 0
        GROUP BY project_id, p
        HAVING p != ''
      )
      GROUP BY level`,
    query_params: {
      ...params(scope),
      steps,
      window: Math.max(1, Math.round(windowDays * 86_400)),
      ...Object.fromEntries(steps.map((s, i) => [`s${i}`, s])),
    },
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ level: string; n: string }>()
  return steps.map((_, i) =>
    rows.filter((r) => Number(r.level) >= i + 1).reduce((sum, r) => sum + Number(r.n), 0),
  )
}

export interface KeyEventRate {
  orgId: string
  projectId: string
  event: string
  /** The newest one in the last 8 days. */
  last: Date | null
  /** Per hour at this time of day: the same hour on each of the last 7 days, averaged. */
  normal: number
}

const DAY_S = 86_400
const HALF_HOUR_S = 1_800

/** When each key event last arrived and how often it normally does at this hour. */
export async function keyEventRates(
  client: ClickHouseClient,
  keys: (KeyEventRef & { orgId: string })[],
  at: Date,
): Promise<KeyEventRate[]> {
  if (keys.length === 0) return []
  const offset = `(toUnixTimestamp({at:DateTime64(3, 'UTC')}) - toUnixTimestamp(timestamp)) % ${DAY_S}`
  const result = await client.query({
    query: `SELECT toString(project_id) AS project, event,
        max(timestamp) AS last,
        countIf(timestamp < {until:DateTime64(3, 'UTC')}
          AND (${offset} <= ${HALF_HOUR_S} OR ${offset} >= ${DAY_S - HALF_HOUR_S})) AS before
      FROM events
      WHERE org_id IN {orgs:Array(UUID)} AND project_id IN {projects:Array(UUID)}
        AND ${IS_KEY} AND is_bot = 0
        AND timestamp >= {since:DateTime64(3, 'UTC')} AND timestamp <= {at:DateTime64(3, 'UTC')}
      GROUP BY project_id, event`,
    query_params: {
      orgs: [...new Set(keys.map((k) => k.orgId))],
      projects: [...new Set(keys.map((k) => k.projectId))],
      keys: keyRefs(keys),
      at: toClickHouseTime(at),
      since: toClickHouseTime(new Date(at.getTime() - (7 * DAY_S + HALF_HOUR_S) * 1000)),
      until: toClickHouseTime(new Date(at.getTime() - (DAY_S - HALF_HOUR_S) * 1000)),
    },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const rows = await result.json<{ project: string; event: string; last: string; before: string }>()
  return keys.map((k) => {
    const row = rows.find((r) => r.project === k.projectId && r.event === k.event)
    return {
      orgId: k.orgId,
      projectId: k.projectId,
      event: k.event,
      last: row ? new Date(row.last) : null,
      normal: Number(row?.before ?? 0) / 7,
    }
  })
}

/** The newest product event of one source in the last day: Set up Product usage waits for it. */
export async function lastUsageEvent(
  client: ClickHouseClient,
  orgId: string,
  projectId: string,
  sourceId: string,
): Promise<{ at: Date; event: string } | null> {
  const result = await client.query({
    query: `SELECT timestamp AS at, event
      FROM events
      WHERE org_id = {org:UUID} AND project_id = {project:UUID} AND source_id = {source:UUID}
        AND timestamp >= now() - INTERVAL 1 DAY AND ${PRODUCT_EVENT} AND NOT startsWith(event, '$')
      ORDER BY timestamp DESC
      LIMIT 1`,
    query_params: { org: orgId, project: projectId, source: sourceId },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  const [row] = await result.json<{ at: string; event: string }>()
  return row ? { at: new Date(row.at), event: row.event } : null
}
