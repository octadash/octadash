import {
  bucketStarts,
  countNewIssues,
  type ErrorPoint,
  errorSeries,
  errorsByProduct,
  fillSeries,
  getOrganizationSettings,
  listIncidentsBetween,
  listOrgAreas,
  listOrgMonitors,
  onlineNow,
  type ProductUptimeHistory,
  type TrafficPoint,
  trafficBreakdown,
  trafficSeries,
  trafficSeriesByProduct,
  uptimeHistory,
} from '@octadash/db'
import { type ProductStatus, worstStatus } from '@/lib/monitors'
import { type Period, type PeriodId, periodOf } from '@/lib/period'
import { services } from './context'

/**
 * Everything the Overview shows for a scope (every product, a group or one
 * product) over a period. Each area adds its numbers only where a product uses
 * it; ClickHouse being down leaves the numbers empty, never the page broken.
 */

export interface OverviewProduct {
  id: string
  slug: string
  name: string
}

export type HourState = 'up' | 'down' | 'none'

export interface OverviewRow extends OverviewProduct {
  status: ProductStatus
  /** An emergency open right now: the row goes first and says so. `takenBy`: who is on it. */
  emergency: { since: Date; takenBy: string | null } | null
  uptime: { ratio: number | null; hours: HourState[] } | null
  traffic: { visitors: number; previous: number; spark: number[] } | null
  /** Errors in the period, when the product uses Errors. */
  errors: { events: number; previous: number; issues: number } | null
}

export interface TimelineItem {
  kind: 'down' | 'notice'
  from: Date
  /** Null while still open. */
  to: Date | null
  /** Incident kind, for the sentence: monitor_down, heartbeat_missed, cert_expiring. */
  incident: string
  name: string | null
}

export interface Overview {
  period: Period
  timeZone: string
  /** False when ClickHouse did not answer: numbers from it are missing. */
  complete: boolean
  uptime: { products: number; upNow: number; ratio: number | null; spark: number[] } | null
  traffic: {
    visitors: number
    previous: number
    online: number
    series: TrafficPoint[]
    previousSeries: TrafficPoint[]
  } | null
  errors: {
    events: number
    previous: number
    /** Issues first seen in the period. */
    newIssues: number
    series: ErrorPoint[]
    previousSeries: ErrorPoint[]
  } | null
  /** Incident starts, to mark on the chart. */
  marks: { at: Date; product: string }[]
  rows: OverviewRow[]
  timeline: { product: OverviewProduct; items: TimelineItem[] }[]
}

async function safely<T>(work: () => Promise<T>, fallback: T, failed: () => void): Promise<T> {
  try {
    return await work()
  } catch {
    failed()
    return fallback
  }
}

export async function loadOverview(
  orgId: string,
  products: OverviewProduct[],
  periodId: PeriodId,
  now = new Date(),
): Promise<Overview> {
  const { db, clickhouse } = services()
  const settings = await getOrganizationSettings(db, orgId)
  const timeZone = settings.timeZone
  const period = periodOf(periodId, now)
  const ids = products.map((p) => p.id)
  const scope = { orgId, projectIds: ids, from: period.from, to: period.to, timeZone }
  const previousScope = { ...scope, ...period.previous }

  let complete = true
  const failed = () => {
    complete = false
  }
  const [monitors, areas, incidents] = await Promise.all([
    listOrgMonitors(db, orgId),
    listOrgAreas(db, orgId),
    listIncidentsBetween(db, orgId, ids, period.from, period.to),
  ])
  const [
    history,
    rowBuckets,
    byProduct,
    previousByProduct,
    series,
    previousSeries,
    sparks,
    online,
  ] = await Promise.all([
    safely(
      () => uptimeHistory(clickhouse, scope, period.row),
      new Map<string, ProductUptimeHistory>(),
      failed,
    ),
    safely(() => bucketStarts(clickhouse, scope, period.row), [] as Date[], failed),
    safely(() => trafficBreakdown(clickhouse, scope, 'product', ids.length), [], failed),
    safely(() => trafficBreakdown(clickhouse, previousScope, 'product', ids.length), [], failed),
    safely(() => trafficSeries(clickhouse, scope, period.chart), [], failed),
    safely(() => trafficSeries(clickhouse, previousScope, period.chart), [], failed),
    safely(
      () => trafficSeriesByProduct(clickhouse, scope, period.row),
      new Map<string, TrafficPoint[]>(),
      failed,
    ),
    safely(() => onlineNow(clickhouse, scope, now), 0, failed),
  ])
  const noErrors = new Map<string, { events: number; issues: number }>()
  const [errorsNow, errorsBefore, errorPoints, previousErrorPoints, newIssues] = await Promise.all([
    safely(() => errorsByProduct(clickhouse, scope), noErrors, failed),
    safely(() => errorsByProduct(clickhouse, previousScope), noErrors, failed),
    safely(() => errorSeries(clickhouse, scope, period.chart), [] as ErrorPoint[], failed),
    safely(() => errorSeries(clickhouse, previousScope, period.chart), [] as ErrorPoint[], failed),
    countNewIssues(db, orgId, ids, period.from, period.to),
  ])

  const takers = [...new Set(incidents.map((i) => i.acknowledged_by).filter((id) => id !== null))]
  const names = new Map(
    takers.length > 0
      ? (
          await db
            .selectFrom('auth_user')
            .select(['id', 'name'])
            .where('id', 'in', takers)
            .execute()
        ).map((u) => [u.id, u.name])
      : [],
  )

  const visitorsOf = new Map(byProduct.map((r) => [r.value, r.visitors]))
  const previousOf = new Map(previousByProduct.map((r) => [r.value, r.visitors]))
  const open = incidents.filter((i) => i.resolved_at === null && i.level === 'emergency')

  const rows: OverviewRow[] = products.map((product) => {
    const own = monitors.filter((m) => m.project_id === product.id && !m.paused)
    const past = history.get(product.id)
    const usesTraffic =
      areas.get(product.id)?.get('traffic') === 'set_up' ||
      visitorsOf.has(product.id) ||
      previousOf.has(product.id)
    const usesErrors =
      areas.get(product.id)?.get('errors') === 'set_up' ||
      errorsNow.has(product.id) ||
      errorsBefore.has(product.id)
    const emergency = open
      .filter((i) => i.project_id === product.id)
      .sort((a, b) => a.started_at.getTime() - b.started_at.getTime())[0]
    return {
      ...product,
      status: worstStatus(own.map((m) => m.status)),
      emergency: emergency
        ? {
            since: emergency.started_at,
            takenBy: emergency.acknowledged_by
              ? (names.get(emergency.acknowledged_by) ?? null)
              : null,
          }
        : null,
      uptime:
        own.length > 0 || past
          ? {
              ratio: past && past.checks > 0 ? past.ups / past.checks : null,
              hours: (past?.buckets ?? rowBuckets.map((at) => ({ at, checks: 0, downs: 0 }))).map(
                (b) => (b.checks === 0 ? 'none' : b.downs > 0 ? 'down' : 'up'),
              ),
            }
          : null,
      traffic: usesTraffic
        ? {
            visitors: visitorsOf.get(product.id) ?? 0,
            previous: previousOf.get(product.id) ?? 0,
            spark: fillSeries(sparks.get(product.id) ?? [], rowBuckets).map((p) => p.visitors),
          }
        : null,
      errors: usesErrors
        ? {
            events: errorsNow.get(product.id)?.events ?? 0,
            previous: errorsBefore.get(product.id)?.events ?? 0,
            issues: errorsNow.get(product.id)?.issues ?? 0,
          }
        : null,
    }
  })
  // Emergencies first, then products that are down, then by visitors, then by name.
  rows.sort(
    (a, b) =>
      Number(Boolean(b.emergency)) - Number(Boolean(a.emergency)) ||
      Number(b.status === 'down') - Number(a.status === 'down') ||
      (b.traffic?.visitors ?? -1) - (a.traffic?.visitors ?? -1) ||
      a.name.localeCompare(b.name),
  )

  const withUptime = rows.filter((r) => r.uptime)
  let checks = 0
  let ups = 0
  for (const id of ids) {
    const past = history.get(id)
    if (!past) continue
    checks += past.checks
    ups += past.ups
  }
  const spark = rowBuckets.map((_, i) => {
    let c = 0
    let d = 0
    for (const past of history.values()) {
      c += past.buckets[i]?.checks ?? 0
      d += past.buckets[i]?.downs ?? 0
    }
    return c === 0 ? 100 : ((c - d) / c) * 100
  })
  const trafficRows = rows.filter((r) => r.traffic)
  const errorRows = rows.filter((r) => r.errors)
  const sum = (m: Map<string, { events: number }>) =>
    [...m.values()].reduce((total, v) => total + v.events, 0)

  const timeline = products
    .map((product) => ({
      product,
      items: incidents
        .filter((i) => i.project_id === product.id && i.parent_id === null)
        .map<TimelineItem>((i) => ({
          kind: i.kind === 'cert_expiring' ? 'notice' : 'down',
          from: new Date(Math.max(i.started_at.getTime(), period.from.getTime())),
          to: i.resolved_at,
          incident: i.kind,
          name:
            typeof (i.data as { name?: unknown })?.name === 'string'
              ? (i.data as { name: string }).name
              : null,
        })),
    }))
    .filter((entry) => entry.items.length > 0)

  return {
    period,
    timeZone,
    complete,
    uptime:
      withUptime.length > 0
        ? {
            products: withUptime.length,
            upNow: withUptime.filter((r) => r.status === 'up').length,
            ratio: checks > 0 ? ups / checks : null,
            spark,
          }
        : null,
    traffic:
      trafficRows.length > 0
        ? {
            visitors: byProduct.reduce((sum, r) => sum + r.visitors, 0),
            previous: previousByProduct.reduce((sum, r) => sum + r.visitors, 0),
            online,
            series,
            previousSeries,
          }
        : null,
    errors:
      errorRows.length > 0
        ? {
            events: sum(errorsNow),
            previous: sum(errorsBefore),
            newIssues,
            series: errorPoints,
            previousSeries: previousErrorPoints,
          }
        : null,
    marks: incidents
      .filter((i) => i.parent_id === null && i.level === 'emergency' && i.started_at >= period.from)
      .map((i) => ({ at: i.started_at, product: i.project_id })),
    rows,
    timeline,
  }
}
