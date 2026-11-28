import {
  countIssues,
  countNewIssues,
  type ErrorEvent,
  type ErrorPoint,
  type ErrorTotals,
  errorSeries,
  errorTotals,
  getIssue,
  getOrganizationSettings,
  type IssueFacet,
  type IssueRecord,
  type IssueTab,
  issueEvent,
  issueFacets,
  issueStats,
  lastIssues,
  listIssues,
  listOpenIncidents,
  listOrgAreas,
  listOrgSources,
  listProjects,
  type Share,
} from '@octadash/db'
import { type ErrorsState, sortIssues } from '@/lib/errors'
import { type ErrorsSetup, errorsSetup, SETUP_ORDER } from '@/lib/errors-setup'
import { type TrafficPeriod, trafficPeriod } from '@/lib/traffic'
import { services } from './context'

type Project = Awaited<ReturnType<typeof listProjects>>[number]

export interface IssueRow extends IssueRecord {
  product: { name: string; slug: string }
  source: string | null
  events: number
  people: number
  /** Events per hour of the last 24 hours. */
  spark: number[]
  /** Behind an open Error spike. */
  spike: boolean
}

export interface ProductSetup extends ErrorsSetup {
  product: { id: string; name: string; slug: string }
  /** The issue seen last, of any age and status. */
  last: { id: string; type: string; value: string; lastSeen: Date } | null
}

export interface ErrorsData {
  period: TrafficPeriod
  timeZone: string
  projects: Project[]
  /** Products in scope with a source, or that sent an error: "6 send errors". */
  sending: number
  totals: ErrorTotals & { newIssues: number }
  previous: ErrorTotals & { newIssues: number }
  series: ErrorPoint[]
  previousSeries: ErrorPoint[]
  counts: Record<IssueTab, number>
  issues: IssueRow[]
  /** Issues in the tab before "Load more". */
  total: number
  /** False when ClickHouse did not answer. */
  complete: boolean
  /** Where each product in scope stands on Errors, the quickest to finish first. */
  setup: ProductSetup[]
}

/** Issues named on an open Error spike of the organization. */
export async function spikingIssues(orgId: string): Promise<Set<string>> {
  const open = await listOpenIncidents(services().db, orgId)
  const ids = new Set<string>()
  for (const incident of open) {
    if (incident.kind !== 'error_spike') continue
    const issues = (incident.data as { issues?: { id?: unknown }[] } | null)?.issues ?? []
    for (const issue of issues) if (typeof issue.id === 'string') ids.add(issue.id)
  }
  return ids
}

const EMPTY: ErrorTotals = { events: 0, issues: 0, people: 0 }

/** Everything the Errors list shows, for every product (null), a group or one product. */
export async function loadErrors(
  orgId: string,
  userId: string,
  projectIds: string[] | null,
  state: ErrorsState,
  now = new Date(),
): Promise<ErrorsData> {
  const { db, clickhouse } = services()
  const [settings, allProjects, sources, spiking, areas] = await Promise.all([
    getOrganizationSettings(db, orgId),
    listProjects(db, orgId),
    listOrgSources(db, orgId),
    spikingIssues(orgId),
    listOrgAreas(db, orgId),
  ])
  const timeZone = settings.timeZone
  const period = trafficPeriod(state.period, now, timeZone)
  const projects = allProjects.filter((p) => projectIds === null || projectIds.includes(p.id))
  const ids = projects.map((p) => p.id)
  const scope = { orgId, projectIds: ids, from: period.from, to: period.to, timeZone }
  const previousScope = { ...scope, ...period.previous }
  const day = { ...scope, from: new Date(now.getTime() - 86_400_000), to: now }

  let complete = true
  const safe = <T>(run: () => Promise<T>, fallback: T) =>
    run().catch(() => {
      complete = false
      return fallback
    })

  const [totals, before, series, previousSeries, newNow, newBefore, counts, records, last] =
    await Promise.all([
      safe(() => errorTotals(clickhouse, scope), EMPTY),
      safe(() => errorTotals(clickhouse, previousScope), EMPTY),
      safe(() => errorSeries(clickhouse, scope, period.bucket), []),
      safe(() => errorSeries(clickhouse, previousScope, period.bucket), []),
      countNewIssues(db, orgId, ids, period.from, period.to),
      countNewIssues(db, orgId, ids, period.previous.from, period.previous.to),
      countIssues(db, orgId, ids, period.from, userId),
      listIssues(db, orgId, { projectIds: ids, tab: state.tab, since: period.from, userId }),
      lastIssues(db, orgId, ids),
    ])
  const [stats, sparks] = await Promise.all([
    safe(() => issueStats(clickhouse, scope, 24), new Map()),
    safe(() => issueStats(clickhouse, day, 24), new Map()),
  ])

  const byId = new Map(projects.map((p) => [p.id, p]))
  const sourceName = new Map(sources.map((s) => [s.id, s.name]))
  const rows: IssueRow[] = records.map((issue) => {
    const s = stats.get(issue.id)
    const product = byId.get(issue.project_id)
    return {
      ...issue,
      product: { name: product?.name ?? '', slug: product?.slug ?? '' },
      source: sourceName.get(s?.source ?? sparks.get(issue.id)?.source ?? '') ?? null,
      events: s?.events ?? 0,
      people: s?.people ?? 0,
      spark: sparks.get(issue.id)?.spark ?? Array(24).fill(0),
      spike: spiking.has(issue.id),
    }
  })
  const sorted = sortIssues(rows, state.sort)
  const sendingIds = new Set(
    sources.filter((s) => s.areas.includes('errors')).map((s) => s.project_id),
  )
  for (const issue of records) sendingIds.add(issue.project_id)
  const setup = projects
    .map((p) => ({
      product: { id: p.id, name: p.name, slug: p.slug },
      last: last.get(p.id) ?? null,
      ...errorsSetup({
        sources: sources.filter((s) => s.project_id === p.id),
        hadIssue: last.has(p.id),
        dismissed: areas.get(p.id)?.get('errors') === 'dismissed',
      }),
    }))
    .sort((a, b) => SETUP_ORDER[a.state] - SETUP_ORDER[b.state])

  return {
    period,
    timeZone,
    projects,
    sending: projects.filter((p) => sendingIds.has(p.id)).length,
    totals: { ...totals, newIssues: newNow },
    previous: { ...before, newIssues: newBefore },
    series,
    previousSeries,
    counts,
    issues: sorted.slice(0, state.show),
    total: sorted.length,
    complete,
    setup,
  }
}

export interface IssueData {
  issue: IssueRecord
  product: Project
  source: { name: string; platform: string } | null
  event: ErrorEvent | null
  /** Events and people of the last 30 days. */
  stats: { events: number; people: number }
  series: ErrorPoint[]
  facets: Record<IssueFacet, Share[]>
  timeZone: string
  /** Behind an open Error spike. */
  spike: boolean
  complete: boolean
}

/** One issue's page: its record, the last 30 days, who it hits and one event. */
export async function loadIssue(
  orgId: string,
  issueId: string,
  eventId: string | undefined,
  now = new Date(),
): Promise<IssueData | null> {
  const { db, clickhouse } = services()
  const issue = await getIssue(db, orgId, issueId)
  if (!issue) return null
  const [settings, projects, sources, spiking] = await Promise.all([
    getOrganizationSettings(db, orgId),
    listProjects(db, orgId),
    listOrgSources(db, orgId),
    spikingIssues(orgId),
  ])
  const product = projects.find((p) => p.id === issue.project_id)
  if (!product) return null
  const timeZone = settings.timeZone
  const scope = {
    orgId,
    projectIds: [product.id],
    from: new Date(now.getTime() - 30 * 86_400_000),
    to: now,
    timeZone,
  }
  let complete = true
  const safe = <T>(run: () => Promise<T>, fallback: T) =>
    run().catch(() => {
      complete = false
      return fallback
    })
  const [event, stats, series, facets] = await Promise.all([
    safe(() => issueEvent(clickhouse, orgId, issue.id, eventId), null),
    safe(() => issueStats(clickhouse, scope, 1), new Map()),
    safe(() => errorSeries(clickhouse, scope, 'day', issue.id), []),
    safe(() => issueFacets(clickhouse, scope, issue.id), {
      browser: [],
      release: [],
      path: [],
      country: [],
    } as unknown as Record<IssueFacet, Share[]>),
  ])
  const source = event ? sources.find((s) => s.id === event.source_id) : undefined
  const s = stats.get(issue.id)
  return {
    issue,
    product,
    source: source ? { name: source.name, platform: source.platform } : null,
    event,
    stats: { events: s?.events ?? 0, people: s?.people ?? 0 },
    series,
    facets,
    timeZone,
    spike: spiking.has(issue.id),
    complete,
  }
}
