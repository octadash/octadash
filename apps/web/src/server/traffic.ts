import {
  getOrganizationSettings,
  listOrgAreas,
  listProjects,
  listTrafficSources,
  onlineNow,
  type TrafficDimension,
  type TrafficFilter,
  type TrafficPoint,
  type TrafficRow,
  type TrafficScope,
  type TrafficSummary,
  trafficBreakdown,
  trafficDistinct,
  trafficReturning,
  trafficSeries,
  trafficSummary,
} from '@octadash/db'
import { type TrafficPeriod, type TrafficPeriodId, trafficPeriod } from '@/lib/traffic'
import { services } from './context'

type Project = Awaited<ReturnType<typeof listProjects>>[number]
type Source = Awaited<ReturnType<typeof listTrafficSources>>[number]

/** The lists of the page, each card with its tabs. */
export const TRAFFIC_CARDS = {
  sources: ['channel', 'source', 'campaign'],
  pages: ['page', 'entry'],
  places: ['country'],
  devices: ['device', 'browser', 'os', 'screen'],
} as const satisfies Record<string, readonly TrafficDimension[]>

/** Rows each list shows before "Details". */
export const LIST_ROWS = 6

export interface TrafficTotals extends TrafficSummary {
  /** Share of returning visitors, when some source in scope counts them. */
  returning: number | null
}

export interface TrafficList {
  rows: TrafficRow[]
  /** Different values in the period: "184 sources". */
  total: number
}

export interface TrafficData {
  period: TrafficPeriod
  timeZone: string
  /** Products in scope. */
  projects: Project[]
  /** Products in scope that do not use Traffic: not set up and no page views. */
  without: Project[]
  sources: Source[]
  /** Sources in scope that count returning visitors. */
  counting: number
  totals: TrafficTotals
  previous: TrafficTotals
  series: TrafficPoint[]
  previousSeries: TrafficPoint[]
  online: number
  lists: Partial<Record<TrafficDimension, TrafficList>>
  /** False when ClickHouse did not answer: the page says numbers are missing. */
  complete: boolean
}

/**
 * Everything the Traffic page shows, for every product (`projectIds` null), a
 * group or one product, with the filters someone clicked. Every number leaves
 * bots out; how many were left out is shown.
 */
export async function loadTraffic(
  orgId: string,
  projectIds: string[] | null,
  periodId: TrafficPeriodId,
  filters: TrafficFilter[],
  now = new Date(),
): Promise<TrafficData> {
  const { db, clickhouse } = services()
  const [settings, allProjects, allSources, areas] = await Promise.all([
    getOrganizationSettings(db, orgId),
    listProjects(db, orgId),
    listTrafficSources(db, orgId),
    listOrgAreas(db, orgId),
  ])
  const timeZone = settings.timeZone
  const period = trafficPeriod(periodId, now, timeZone)
  const keep = (id: string) => projectIds === null || projectIds.includes(id)
  const projects = allProjects.filter((p) => keep(p.id))
  const sources = allSources.filter((s) => keep(s.project_id))
  const counting = sources.filter((s) => s.visitor_mode === 'persistent').map((s) => s.id)
  const scope: TrafficScope = {
    orgId,
    projectIds: projects.map((p) => p.id),
    from: period.from,
    to: period.to,
    timeZone,
    filters,
  }
  const previousScope = { ...scope, ...period.previous }

  let complete = true
  const safe = <T>(run: () => Promise<T>, fallback: T) =>
    run().catch(() => {
      complete = false
      return fallback
    })
  const empty: TrafficSummary = { pageviews: 0, visitors: 0, bots: 0 }
  const several = projects.length > 1
  const dimensions: TrafficDimension[] = [
    ...(several ? (['product'] as const) : []),
    ...(!several && sources.length > 1 ? (['origin'] as const) : []),
    ...Object.values(TRAFFIC_CARDS).flat(),
  ]

  const [summary, before, returning, returningBefore, series, previousSeries, online, lists] =
    await Promise.all([
      safe(() => trafficSummary(clickhouse, scope), empty),
      safe(() => trafficSummary(clickhouse, previousScope), empty),
      safe(() => trafficReturning(clickhouse, scope, counting), null),
      safe(() => trafficReturning(clickhouse, previousScope, counting), null),
      safe(() => trafficSeries(clickhouse, scope, period.bucket), []),
      safe(() => trafficSeries(clickhouse, previousScope, period.bucket), []),
      safe(() => onlineNow(clickhouse, scope, now), 0),
      Promise.all(
        dimensions.map(async (dimension) => {
          const [rows, total] = await Promise.all([
            safe(
              () =>
                trafficBreakdown(clickhouse, scope, dimension, {
                  limit:
                    dimension === 'product'
                      ? projects.length
                      : dimension === 'origin'
                        ? sources.length
                        : LIST_ROWS,
                  byProduct: several,
                }),
              [],
            ),
            safe(() => trafficDistinct(clickhouse, scope, dimension, several), 0),
          ])
          return [dimension, { rows, total }] as const
        }),
      ),
    ])

  const share = (r: { visitors: number; returning: number } | null) =>
    r && r.visitors > 0 ? r.returning / r.visitors : null
  const sending = new Set(
    (lists.find(([d]) => d === 'product')?.[1].rows ?? []).map((r) => r.value),
  )
  const without = several
    ? projects.filter(
        (p) =>
          !sending.has(p.id) &&
          areas.get(p.id)?.get('traffic') !== 'set_up' &&
          !sources.some((s) => s.project_id === p.id),
      )
    : []

  return {
    period,
    timeZone,
    projects,
    without,
    sources,
    counting: counting.length,
    totals: { ...summary, returning: share(returning) },
    previous: { ...before, returning: share(returningBefore) },
    series,
    previousSeries,
    online,
    lists: Object.fromEntries(lists),
    complete,
  }
}
