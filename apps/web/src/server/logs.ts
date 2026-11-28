import {
  compileLogQuery,
  DEFAULT_LOG_RETENTION_DAYS,
  errorsInTraces,
  getGroupBySlug,
  getOrganizationSettings,
  type LogBucket,
  type LogLine,
  type LogSearch,
  listLogSearches,
  listOrgSources,
  listProjects,
  logHistogram,
  logRetention,
  parseLogQuery,
  productsIn,
  searchLogs,
} from '@octadash/db'
import { histogramStep, LOG_PAGE, type LogsState } from '@/lib/logs'
import { type TrafficPeriod, trafficPeriod } from '@/lib/traffic'
import { services } from './context'

type Project = Awaited<ReturnType<typeof listProjects>>[number]

/** A line as the browser gets it: with its product and the error in its trace. */
export interface ShownLine extends LogLine {
  product: { name: string; slug: string }
  /** Errors in the same trace, with the issue to open. */
  error: { count: number; href: string } | null
}

export interface LogsData {
  period: TrafficPeriod
  timeZone: string
  projects: Project[]
  lines: ShownLine[]
  histogram: LogBucket[]
  /** Seconds per bar. */
  step: number
  total: number
  searches: LogSearch[]
  /** Days kept: one number when every product in scope keeps the same. */
  retention: { min: number; max: number }
  /** Products in scope with a source that sends logs. */
  sending: number
  /** `product:` names in the search that match no product. */
  unknownProducts: string[]
  /** Any line in the last 90 days, so an empty search is told apart from nothing set up. */
  anyLine: boolean
  complete: boolean
}

/** The products of a scope: everything (null), a group or one product, checked against the organization. */
export async function scopeProjects(orgId: string, scope: string): Promise<Project[] | null> {
  const { db } = services()
  const projects = await listProjects(db, orgId)
  if (scope === 'all') return projects
  const [kind, slug] = [scope.slice(0, 2), scope.slice(2)]
  if (kind === 'p:') {
    const project = projects.find((p) => p.slug === slug)
    return project ? [project] : null
  }
  if (kind === 'g:') {
    const group = await getGroupBySlug(db, orgId, slug)
    return group ? projects.filter((p) => group.project_ids.includes(p.id)) : null
  }
  return null
}

/**
 * Lines for the list: newest first, or older than `before` ("Load older"), or
 * newer than `after` (Live). Each with its product and the error of its trace.
 */
export async function loadLines(
  orgId: string,
  projects: Project[],
  allProjects: Project[],
  q: string,
  period: { from: Date; to: Date },
  cursor: { before?: string; after?: string } = {},
): Promise<ShownLine[]> {
  const { clickhouse } = services()
  const query = compileLogQuery(parseLogQuery(q), new Map(allProjects.map((p) => [p.slug, p.id])))
  const lines = await searchLogs(
    clickhouse,
    { orgId, projectIds: projects.map((p) => p.id), from: period.from, to: period.to },
    query,
    { limit: LOG_PAGE, ...cursor },
  )
  const errors = await errorsInTraces(
    clickhouse,
    orgId,
    lines.map((l) => l.traceId),
  ).catch(() => new Map())
  const byId = new Map(allProjects.map((p) => [p.id, p]))
  return lines.map((line) => {
    const product = byId.get(line.projectId)
    const error = line.traceId ? errors.get(line.traceId) : undefined
    const errorProduct = error ? byId.get(error.projectId) : undefined
    return {
      ...line,
      product: { name: product?.name ?? '', slug: product?.slug ?? '' },
      error:
        error && errorProduct
          ? { count: error.count, href: `/p/${errorProduct.slug}/errors/${error.issueId}` }
          : null,
    }
  })
}

/** Everything the Logs page shows, for every product (null), a group or one product. */
export async function loadLogs(
  orgId: string,
  projectIds: string[] | null,
  state: LogsState,
  now = new Date(),
): Promise<LogsData> {
  const { db, clickhouse } = services()
  const [settings, allProjects, sources, searches] = await Promise.all([
    getOrganizationSettings(db, orgId),
    listProjects(db, orgId),
    listOrgSources(db, orgId),
    listLogSearches(db, orgId),
  ])
  const timeZone = settings.timeZone
  const period = trafficPeriod(state.period, now, timeZone)
  const projects = allProjects.filter((p) => projectIds === null || projectIds.includes(p.id))
  const ids = projects.map((p) => p.id)
  const terms = parseLogQuery(state.q)
  const slugs = new Map(allProjects.map((p) => [p.slug, p.id]))
  const query = compileLogQuery(terms, slugs)
  const step = histogramStep(state.period, period.to.getTime() - period.from.getTime())
  const scope = { orgId, projectIds: ids, from: period.from, to: period.to }

  let complete = true
  const safe = <T>(run: () => Promise<T>, fallback: T) =>
    run().catch(() => {
      complete = false
      return fallback
    })
  const [lines, histogram, seen, retention] = await Promise.all([
    safe(() => loadLines(orgId, projects, allProjects, state.q, period), [] as ShownLine[]),
    safe(() => logHistogram(clickhouse, scope, query, step), [] as LogBucket[]),
    safe(
      () =>
        searchLogs(
          clickhouse,
          { ...scope, from: new Date(now.getTime() - 90 * 86_400_000), to: now },
          compileLogQuery([]),
          { limit: 1 },
        ),
      [],
    ),
    logRetention(db, ids),
  ])
  const days = [...retention.values()]
  const sendingIds = new Set(
    sources.filter((s) => s.areas.includes('logs')).map((s) => s.project_id),
  )
  return {
    period,
    timeZone,
    projects,
    lines,
    histogram,
    step,
    total: histogram.reduce((n, b) => n + b.error + b.warn + b.info, 0),
    searches,
    retention: {
      min: days.length > 0 ? Math.min(...days) : DEFAULT_LOG_RETENTION_DAYS,
      max: days.length > 0 ? Math.max(...days) : DEFAULT_LOG_RETENTION_DAYS,
    },
    sending: projects.filter((p) => sendingIds.has(p.id)).length,
    unknownProducts: productsIn(terms).filter((slug) => !slugs.has(slug)),
    anyLine: seen.length > 0 || lines.length > 0,
    complete,
  }
}
