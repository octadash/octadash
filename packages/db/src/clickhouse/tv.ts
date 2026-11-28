import type { ClickHouseClient } from '@clickhouse/client'
import { ISO_TIMES } from './buckets'
import { toClickHouseTime } from './events'

/** The TV shows the last 4 hours in 5-minute slots. */
export const TV_SLOT_MS = 5 * 60_000
export const TV_SLOTS = 48

export type TvSlot = 'up' | 'down' | 'none'

export interface TvActivity {
  /** Checks of the last 4 hours, oldest first: down when any check of the slot failed. */
  checks: TvSlot[] | null
  /** Mean answer time of the checks that passed in the last hour. */
  responseMs: number | null
  /** People on the site in the last 5 minutes. */
  visitorsNow: number
  /** Visitors per slot over the last 4 hours, for the line. */
  spark: number[]
  pageviewsToday: number
  eventsToday: number
}

const VISITOR = `if(distinct_id != '', distinct_id, visitor_id)`

function slotOf(at: Date, from: number) {
  return Math.floor((at.getTime() - from) / TV_SLOT_MS)
}

/**
 * Everything the TV tiles read from ClickHouse, per product, in three small
 * queries: uptime checks and page views of the last 4 hours, and today's
 * totals since `dayStart` (local midnight of the organization).
 */
export async function tvActivity(
  client: ClickHouseClient,
  orgId: string,
  projectIds: string[],
  dayStart: Date,
  now = new Date(),
): Promise<Map<string, TvActivity>> {
  const activity = new Map<string, TvActivity>()
  if (projectIds.length === 0) return activity
  // Slots end at the current 5-minute boundary, so they do not shift every second.
  const end = Math.floor(now.getTime() / TV_SLOT_MS) * TV_SLOT_MS + TV_SLOT_MS
  const from = end - TV_SLOTS * TV_SLOT_MS
  const params = {
    org: orgId,
    projects: projectIds,
    from: toClickHouseTime(new Date(from)),
    hour: toClickHouseTime(new Date(now.getTime() - 3_600_000)),
    recent: toClickHouseTime(new Date(now.getTime() - 5 * 60_000)),
    day: toClickHouseTime(dayStart),
  }
  const where = `org_id = {org:UUID} AND project_id IN {projects:Array(UUID)}`
  const get = (id: string) => {
    let entry = activity.get(id)
    if (!entry) {
      entry = {
        checks: null,
        responseMs: null,
        visitorsNow: 0,
        spark: Array(TV_SLOTS).fill(0),
        pageviewsToday: 0,
        eventsToday: 0,
      }
      activity.set(id, entry)
    }
    return entry
  }

  const [checks, views, today] = await Promise.all([
    client
      .query({
        query: `
          SELECT toString(project_id) AS product, toStartOfFiveMinutes(timestamp) AS at,
            count() AS checks, countIf(up = 0) AS downs,
            sumIf(duration_ms, up = 1 AND timestamp >= {hour:DateTime64(3, 'UTC')}) AS ms,
            countIf(up = 1 AND duration_ms IS NOT NULL AND timestamp >= {hour:DateTime64(3, 'UTC')}) AS timed
          FROM uptime_checks
          WHERE ${where} AND timestamp >= {from:DateTime64(3, 'UTC')}
          GROUP BY product, at`,
        query_params: params,
        clickhouse_settings: ISO_TIMES,
        format: 'JSONEachRow',
      })
      .then((r) =>
        r.json<{
          product: string
          at: string
          checks: string
          downs: string
          ms: string | null
          timed: string
        }>(),
      ),
    client
      .query({
        query: `
          SELECT toString(project_id) AS product, toStartOfFiveMinutes(timestamp) AS at,
            uniq(${VISITOR}) AS visitors
          FROM events
          WHERE ${where} AND event = '$pageview' AND is_bot = 0
            AND timestamp >= {from:DateTime64(3, 'UTC')}
          GROUP BY product, at`,
        query_params: params,
        clickhouse_settings: ISO_TIMES,
        format: 'JSONEachRow',
      })
      .then((r) => r.json<{ product: string; at: string; visitors: string }>()),
    client
      .query({
        query: `
          SELECT toString(project_id) AS product,
            countIf(event = '$pageview' AND is_bot = 0
              AND timestamp >= {day:DateTime64(3, 'UTC')}) AS pageviews,
            countIf(event NOT IN ('$pageview', '$pageleave')
              AND timestamp >= {day:DateTime64(3, 'UTC')}) AS events,
            uniqIf(${VISITOR}, event = '$pageview' AND is_bot = 0
              AND timestamp >= {recent:DateTime64(3, 'UTC')}) AS online
          FROM events
          WHERE ${where}
            AND timestamp >= least({day:DateTime64(3, 'UTC')}, {recent:DateTime64(3, 'UTC')})
          GROUP BY product`,
        query_params: params,
        format: 'JSONEachRow',
      })
      .then((r) =>
        r.json<{ product: string; pageviews: string; events: string; online: string }>(),
      ),
  ])

  const timing = new Map<string, { ms: number; n: number }>()
  for (const row of checks) {
    const entry = get(row.product)
    entry.checks ??= Array(TV_SLOTS).fill('none')
    const slot = slotOf(new Date(row.at), from)
    if (slot >= 0 && slot < TV_SLOTS) entry.checks[slot] = Number(row.downs) > 0 ? 'down' : 'up'
    const t = timing.get(row.product) ?? { ms: 0, n: 0 }
    t.ms += Number(row.ms ?? 0)
    t.n += Number(row.timed)
    timing.set(row.product, t)
  }
  for (const [id, t] of timing) get(id).responseMs = t.n > 0 ? Math.round(t.ms / t.n) : null

  for (const row of views) {
    const slot = slotOf(new Date(row.at), from)
    if (slot >= 0 && slot < TV_SLOTS) get(row.product).spark[slot] = Number(row.visitors)
  }

  for (const row of today) {
    const entry = get(row.product)
    entry.pageviewsToday = Number(row.pageviews)
    entry.eventsToday = Number(row.events)
    entry.visitorsNow = Number(row.online)
  }
  return activity
}
