import {
  type CameBack,
  type Cohort,
  cameBackWeek1,
  type Funnel,
  funnelSteps,
  getOrganizationSettings,
  listFunnels,
  listKeyEvents,
  listOpenIncidents,
  listOrgSources,
  listProjects,
  retentionCohorts,
  SIGNUP_EVENTS,
  type UsageEventRow,
  type UsagePoint,
  type UsageTotals,
  usageEvents,
  usageSeries,
  usageTotals,
} from '@octadash/db'
import { type ScopeSource, scopeSources } from '@/lib/source-scope'
import { type TrafficPeriod, trafficPeriod } from '@/lib/traffic'
import { type Normal, normalOf, normalWindows, type UsageState } from '@/lib/usage'
import { services } from './context'

type Project = Awaited<ReturnType<typeof listProjects>>[number]

export interface UsageEvent extends UsageEventRow {
  product: { name: string; slug: string }
  /** Names of the sources that sent it in the period. */
  sourceNames: string[]
  key: boolean
  /** The period just before, for "vs before". */
  before: number
  normal: Normal
}

export interface FunnelResult extends Funnel {
  product: { name: string; slug: string }
  counts: number[]
}

/** An open "Sign-ups dropped" signal of a product in scope. */
export interface SignupSignal {
  id: string
  href: string
  product: string
  /** Sign-ups in the last 24 hours, those expected, and how far under (percent). */
  count: number
  expected: number
  percent: number
}

export interface UsageData {
  period: TrafficPeriod
  timeZone: string
  projects: Project[]
  /** Products in scope with a source sending events, or that sent one. */
  sending: number
  totals: UsageTotals & { cameBack: CameBack }
  previous: UsageTotals & { cameBack: CameBack }
  series: UsagePoint[]
  previousSeries: UsagePoint[]
  events: UsageEvent[]
  /** Events matching the search, before "Show more". */
  total: number
  funnels: FunnelResult[]
  cohorts: Cohort[]
  /** Any event ever seen in the last 30 days, so an empty period is told apart from nothing set up. */
  anyEvent: boolean
  /** False when ClickHouse did not answer. */
  complete: boolean
  /** Sources of the products in scope, for the source filter. */
  sources: ScopeSource[]
  /** The source the page is filtered to, when it belongs to the scope. */
  source: ScopeSource | null
  signals: SignupSignal[]
}

const NONE: UsageTotals = { active: 0, signups: 0, keyEvents: 0 }

/** Everything the Product usage page shows, for every product (null), a group or one product. */
export async function loadUsage(
  orgId: string,
  projectIds: string[] | null,
  state: UsageState,
  now = new Date(),
): Promise<UsageData> {
  const { db, clickhouse } = services()
  const [settings, allProjects, sources] = await Promise.all([
    getOrganizationSettings(db, orgId),
    listProjects(db, orgId),
    listOrgSources(db, orgId),
  ])
  const timeZone = settings.timeZone
  const period = trafficPeriod(state.period, now, timeZone)
  const projects = allProjects.filter((p) => projectIds === null || projectIds.includes(p.id))
  const ids = projects.map((p) => p.id)
  const [keys, funnels, incidents] = await Promise.all([
    listKeyEvents(db, orgId, ids),
    listFunnels(db, orgId, ids),
    listOpenIncidents(db, orgId),
  ])
  const { sources: inScope, source } = scopeSources(sources, projects, state.source)
  const scope = {
    orgId,
    projectIds: ids,
    sourceIds: source ? [source.id] : [],
    from: period.from,
    to: period.to,
    timeZone,
  }
  const previousScope = { ...scope, ...period.previous }
  // Whether anything ever arrived is asked of every source: one quiet source is not "nothing set up".
  const month = {
    ...scope,
    sourceIds: [],
    from: new Date(now.getTime() - 30 * 86_400_000),
    to: now,
  }
  const refs = keys.map((k) => ({ projectId: k.projectId, event: k.event }))

  let complete = true
  const safe = <T>(run: () => Promise<T>, fallback: T) =>
    run().catch(() => {
      complete = false
      return fallback
    })
  const none = { people: 0, returned: 0 }
  const [totals, before, series, previousSeries, back, backBefore, rows, cohorts, seen] =
    await Promise.all([
      safe(() => usageTotals(clickhouse, scope, SIGNUP_EVENTS, refs), NONE),
      safe(() => usageTotals(clickhouse, previousScope, SIGNUP_EVENTS, refs), NONE),
      safe(() => usageSeries(clickhouse, scope, period.bucket, SIGNUP_EVENTS, refs), []),
      safe(() => usageSeries(clickhouse, previousScope, period.bucket, SIGNUP_EVENTS, refs), []),
      safe(() => cameBackWeek1(clickhouse, scope, SIGNUP_EVENTS), none),
      safe(() => cameBackWeek1(clickhouse, previousScope, SIGNUP_EVENTS), none),
      safe(
        () => usageEvents(clickhouse, scope, [period.previous, ...normalWindows(period)], 500),
        [],
      ),
      safe(() => retentionCohorts(clickhouse, { ...scope, to: now }, SIGNUP_EVENTS), []),
      safe(() => usageTotals(clickhouse, month, SIGNUP_EVENTS, refs), NONE),
    ])
  const funnelCounts = await Promise.all(
    funnels.map((f) =>
      safe(
        () =>
          funnelSteps(clickhouse, { ...scope, projectIds: [f.projectId] }, f.steps, f.windowDays),
        f.steps.map(() => 0),
      ),
    ),
  )

  const byId = new Map(projects.map((p) => [p.id, p]))
  const productOf = (id: string) => ({
    name: byId.get(id)?.name ?? '',
    slug: byId.get(id)?.slug ?? '',
  })
  const isKey = new Set(keys.map((k) => `${k.projectId}:${k.event}`))
  const stopped = new Set(
    incidents
      .filter((i) => i.kind === 'key_event_stopped')
      .map((i) => `${i.project_id}:${String((i.data as { event?: unknown } | null)?.event ?? '')}`),
  )
  const sourceName = new Map(sources.map((s) => [s.id, s.name]))
  const events: UsageEvent[] = rows.map((row) => {
    const id = `${row.projectId}:${row.event}`
    const [previous = 0, ...normal] = row.baseline
    return {
      ...row,
      product: productOf(row.projectId),
      sourceNames: row.sourceIds.map((s) => sourceName.get(s) ?? '').filter(Boolean),
      key: isKey.has(id),
      before: previous,
      normal: normalOf(row.count, normal, stopped.has(id)),
    }
  })
  // Key events stay on the list even in a period without any: that is when they matter.
  for (const k of keys) {
    if (events.some((e) => e.projectId === k.projectId && e.event === k.event)) continue
    events.push({
      projectId: k.projectId,
      event: k.event,
      count: 0,
      people: 0,
      baseline: [],
      last: null,
      sourceIds: [],
      sourceNames: [],
      product: productOf(k.projectId),
      key: true,
      before: 0,
      normal: normalOf(0, [], stopped.has(`${k.projectId}:${k.event}`)),
    })
  }
  events.sort(
    (a, b) =>
      Number(b.normal.status === 'stopped') - Number(a.normal.status === 'stopped') ||
      Number(b.key) - Number(a.key) ||
      b.count - a.count ||
      a.event.localeCompare(b.event),
  )
  const q = state.q.toLowerCase()
  const matching = q ? events.filter((e) => e.event.toLowerCase().includes(q)) : events

  const sendingIds = new Set(
    sources.filter((s) => s.areas.includes('usage')).map((s) => s.project_id),
  )
  for (const row of rows) sendingIds.add(row.projectId)

  return {
    period,
    timeZone,
    projects,
    sending: projects.filter((p) => sendingIds.has(p.id)).length,
    totals: { ...totals, cameBack: back },
    previous: { ...before, cameBack: backBefore },
    series,
    previousSeries,
    events: matching.slice(0, state.show),
    total: matching.length,
    funnels: funnels.map((f, i) => ({
      ...f,
      product: productOf(f.projectId),
      counts: funnelCounts[i] ?? [],
    })),
    cohorts,
    anyEvent: seen.active > 0 || rows.length > 0 || keys.length > 0,
    complete,
    sources: inScope,
    source,
    signals: incidents
      .filter((i) => i.kind === 'signups_dropped' && byId.has(i.project_id))
      .map((i) => {
        const d = (i.data ?? {}) as Record<string, unknown>
        const num = (v: unknown) => (typeof v === 'number' ? v : 0)
        return {
          id: i.id,
          href: `/p/${i.project_slug}/emergencies/${i.id}`,
          product: i.project_name,
          count: num(d.count),
          expected: num(d.expected),
          percent: num(d.percent),
        }
      }),
  }
}
