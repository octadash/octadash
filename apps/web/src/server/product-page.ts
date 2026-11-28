import {
  type AreaId,
  compileLogQuery,
  errorSeries,
  issueStats,
  type LogBucket,
  listIssues,
  listMonitors,
  listProjectAreas,
  listSources,
  logHistogram,
  type ProjectAreaState,
  parseLogQuery,
  responseSeries,
  type TrafficRow,
  trafficBreakdown,
  uptimeHistory,
} from '@octadash/db'
import type { PeriodId } from '@/lib/period'
import { services } from './context'
import { type HourState, loadOverview, type Overview, type OverviewProduct } from './overview'
import { safeMonitorStats } from './uptime-view'

/**
 * The product page: the Overview's pattern for one product (numbers, chart,
 * timeline by monitor), then one card per area with that area's short summary.
 */

export interface MonitorLine {
  id: string
  name: string
  status: 'up' | 'down' | 'unknown'
  paused: boolean
  uptime: number | null
  medianMs: number | null
  certDays: number | null
  /** One cell per day of the last 30. */
  days: HourState[]
}

export interface ProductPage {
  overview: Overview
  states: Map<AreaId, ProjectAreaState>
  monitors: MonitorLine[]
  /** Response time per chart bucket, now and before. */
  response: {
    current: { at: Date; medianMs: number | null }[]
    previous: { at: Date; medianMs: number | null }[]
  } | null
  sources: { name: string; platform: string; areas: string[] }[]
  /** The Errors card: the issues hit most in the period and events per day, 14 days. */
  errors: {
    issues: {
      id: string
      type: string
      value: string
      culprit: string
      events: number
      people: number
      isNew: boolean
    }[]
    days: { at: Date; events: number }[]
  } | null
  /** The Logs card: lines per slice of the period by level. */
  logs: LogBucket[] | null
  /** Top values for the Traffic card, by visitors. */
  traffic: Record<'source' | 'page' | 'country' | 'device', TrafficRow[]> | null
}

const DAY = 86_400_000

export async function loadProductPage(
  orgId: string,
  product: OverviewProduct,
  periodId: PeriodId,
  now = new Date(),
): Promise<ProductPage> {
  const { db, clickhouse } = services()
  const overview = await loadOverview(orgId, [product], periodId, now)
  const { period, timeZone } = overview
  const scope = {
    orgId,
    projectIds: [product.id],
    from: period.from,
    to: period.to,
    timeZone,
  }
  const [areaStates, monitors, sources] = await Promise.all([
    listProjectAreas(db, orgId, product.id),
    listMonitors(db, orgId, product.id),
    listSources(db, orgId, product.id),
  ])
  const quiet = <T>(work: Promise<T>, fallback: T) => work.catch(() => fallback)
  const month = { ...scope, from: new Date(now.getTime() - 30 * DAY), to: now }
  const usesTraffic = overview.traffic !== null
  const [stats, history, current, previous, source, page, country, device] = await Promise.all([
    safeMonitorStats(
      clickhouse,
      orgId,
      monitors.map((m) => m.id),
    ),
    quiet(uptimeHistory(clickhouse, month, 'day', 'monitor'), new Map()),
    monitors.length > 0 ? quiet(responseSeries(clickhouse, scope, period.chart), []) : [],
    monitors.length > 0
      ? quiet(responseSeries(clickhouse, { ...scope, ...period.previous }, period.chart), [])
      : [],
    usesTraffic ? quiet(trafficBreakdown(clickhouse, scope, 'source', 5), []) : [],
    usesTraffic ? quiet(trafficBreakdown(clickhouse, scope, 'page', 5), []) : [],
    usesTraffic ? quiet(trafficBreakdown(clickhouse, scope, 'country', 5), []) : [],
    usesTraffic ? quiet(trafficBreakdown(clickhouse, scope, 'device', 5), []) : [],
  ])

  const usesErrors = overview.errors !== null
  const fortnight = { ...scope, from: new Date(now.getTime() - 14 * DAY), to: now }
  const [unresolved, issueNumbers, errorDays] = usesErrors
    ? await Promise.all([
        listIssues(db, orgId, {
          projectIds: [product.id],
          tab: 'unresolved',
          since: period.from,
          userId: '',
          limit: 50,
        }),
        quiet(issueStats(clickhouse, scope, 1), new Map()),
        quiet(errorSeries(clickhouse, fortnight, 'day'), []),
      ])
    : [[], new Map(), []]
  const topIssues = unresolved
    .map((issue) => ({
      id: issue.id,
      type: issue.type,
      value: issue.value,
      culprit: issue.culprit,
      events: issueNumbers.get(issue.id)?.events ?? 0,
      people: issueNumbers.get(issue.id)?.people ?? 0,
      isNew: issue.first_seen >= period.from,
    }))
    .filter((issue) => issue.events > 0)
    .sort((a, b) => b.events - a.events)
    .slice(0, 3)

  const usesLogs = areaStates.get('logs') === 'set_up'
  const logs = usesLogs
    ? await quiet(
        logHistogram(
          clickhouse,
          { orgId, projectIds: [product.id], from: period.from, to: period.to },
          compileLogQuery(parseLogQuery(''), new Map()),
          Math.max(60, Math.round((period.to.getTime() - period.from.getTime()) / 24_000)),
        ),
        null,
      )
    : null

  // Uptime is set up when it has monitors, whatever was stored before.
  const states = new Map(areaStates)
  if (monitors.length > 0) states.set('uptime', 'set_up')
  else if (states.get('uptime') === 'set_up') states.delete('uptime')
  if (usesTraffic && !states.has('traffic')) states.set('traffic', 'set_up')
  if (usesErrors && !states.has('errors')) states.set('errors', 'set_up')

  return {
    overview,
    states,
    monitors: monitors.map((m) => {
      const s = stats.get(m.id)
      const past = history.get(m.id)
      return {
        id: m.id,
        name: m.name,
        status: m.status,
        paused: m.paused,
        uptime: s?.uptime ?? null,
        medianMs: s?.medianMs ?? null,
        certDays: s?.certDays ?? null,
        days: (past?.buckets ?? Array.from({ length: 30 }, () => ({ checks: 0, downs: 0 }))).map(
          (b: { checks: number; downs: number }) =>
            b.checks === 0 ? 'none' : b.downs > 0 ? 'down' : 'up',
        ),
      }
    }),
    response: monitors.length > 0 ? { current, previous } : null,
    sources: sources.map((s) => ({ name: s.name, platform: s.platform, areas: s.areas })),
    traffic: usesTraffic ? { source, page, country, device } : null,
    logs,
    errors: usesErrors
      ? { issues: topIssues, days: errorDays.map((d) => ({ at: d.at, events: d.events })) }
      : null,
  }
}
