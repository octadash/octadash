import {
  getOrganizationSettings,
  listOpenIncidents,
  listOrgMonitors,
  listProjects,
  type MonitorStats,
  monitorStats,
  type ProductUptimeHistory,
  type UptimeTotals,
  uptimeHistory,
  uptimeTotals,
} from '@octadash/db'
import {
  type MonitorState,
  monitorState,
  type OpenMonitorIncident,
  type SameIpGroup,
  sameIpGroups,
  type UptimePeriod,
  type UptimePeriodId,
  uptimePeriod,
} from '@/lib/uptime-board'
import { services } from './context'
import { sameServerUrls } from './same-server'

type Monitor = Awaited<ReturnType<typeof listOrgMonitors>>[number]
type Project = Awaited<ReturnType<typeof listProjects>>[number]

export interface BoardMonitorData {
  monitor: Monitor
  state: MonitorState
  stats: MonitorStats | null
  history: ProductUptimeHistory | null
  sameServer: boolean
}

export interface BoardProductData {
  project: Project
  monitors: BoardMonitorData[]
  history: ProductUptimeHistory | null
}

export interface UptimeBoard {
  period: UptimePeriod
  timeZone: string
  /** Products with at least one monitor. */
  products: BoardProductData[]
  /** Products in scope that do not use Uptime. */
  without: Project[]
  totals: UptimeTotals
  previous: UptimeTotals
  sameIp: SameIpGroup[]
  /** False when ClickHouse did not answer: numbers are missing, states still show. */
  complete: boolean
}

const EMPTY: UptimeTotals = { checks: 0, ups: 0, medianMs: null }

/**
 * Everything the Uptime board shows, for every product (`projectIds` null), a
 * group or one product. States come from Postgres; numbers and bars from
 * ClickHouse, which may fail without taking the page down.
 */
export async function loadUptimeBoard(
  orgId: string,
  projectIds: string[] | null,
  periodId: UptimePeriodId,
  now = new Date(),
): Promise<UptimeBoard> {
  const { db, clickhouse, env } = services()
  const keep = (id: string) => projectIds === null || projectIds.includes(id)
  const [settings, allProjects, allMonitors, incidents] = await Promise.all([
    getOrganizationSettings(db, orgId),
    listProjects(db, orgId),
    listOrgMonitors(db, orgId),
    listOpenIncidents(db, orgId),
  ])
  const timeZone = settings.timeZone
  const period = uptimePeriod(periodId, now)
  const projects = allProjects.filter((p) => keep(p.id))
  const monitors = allMonitors.filter((m) => keep(m.project_id))
  const ids = monitors.map((m) => m.id)
  const scope = { orgId, projectIds: projects.map((p) => p.id), ...period, timeZone }

  let complete = true
  const safe = <T>(promise: Promise<T>, fallback: T) =>
    promise.catch(() => {
      complete = false
      return fallback
    })
  const [stats, recent, byProduct, byMonitor, totals, previous, sameServer] = await Promise.all([
    safe(monitorStats(clickhouse, orgId, ids, period), new Map<string, MonitorStats>()),
    safe(
      monitorStats(clickhouse, orgId, ids, { from: new Date(now.getTime() - 3_600_000), to: now }),
      new Map<string, MonitorStats>(),
    ),
    safe(uptimeHistory(clickhouse, scope, period.bucket), new Map()),
    safe(uptimeHistory(clickhouse, scope, period.bucket, 'monitor'), new Map()),
    safe(uptimeTotals(clickhouse, scope), EMPTY),
    safe(uptimeTotals(clickhouse, { ...scope, ...period.previous }), EMPTY),
    sameServerUrls(
      env.OCTADASH_URL,
      monitors.flatMap((m) => (m.url ? [m.url] : [])),
    ).catch(() => new Set<string>()),
  ])

  const products: BoardProductData[] = []
  const without: Project[] = []
  for (const project of projects) {
    const own = monitors.filter((m) => m.project_id === project.id)
    if (own.length === 0) {
      without.push(project)
      continue
    }
    products.push({
      project,
      history: byProduct.get(project.id) ?? null,
      monitors: own.map((monitor) => {
        const s = stats.get(monitor.id) ?? null
        return {
          monitor,
          stats: s,
          history: byMonitor.get(monitor.id) ?? null,
          sameServer: !!monitor.url && sameServer.has(monitor.url),
          state: monitorState(
            monitor,
            {
              lastAt: s?.lastAt ?? null,
              lastUp: s?.lastUp ?? null,
              lastError: s?.lastError ?? null,
              periodMedianMs: s?.medianMs ?? null,
              recentMedianMs: recent.get(monitor.id)?.medianMs ?? null,
            },
            timeZone,
            now,
          ),
        }
      }),
    })
  }

  const open: OpenMonitorIncident[] = incidents
    .filter((i) => keep(i.project_id))
    .map((i) => ({ ...i, data: (i.data ?? {}) as Record<string, unknown> }))

  return {
    period,
    timeZone,
    products,
    without,
    totals,
    previous,
    sameIp: sameIpGroups(open),
    complete,
  }
}
