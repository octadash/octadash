import { ISSUE_TABS, type IssueTab } from '@octadash/db'
import { sourceParam } from './source-scope'
import { TRAFFIC_PERIODS, type TrafficPeriodId } from './traffic'

/**
 * The Errors pages, as closed in the Errors canvas: the periods of Traffic,
 * the issue tabs and the orders of the list, all kept in the address.
 */

export const ERROR_PERIODS = TRAFFIC_PERIODS
export type ErrorPeriodId = TrafficPeriodId

export const ERROR_SORTS = ['people', 'events', 'newest', 'recent'] as const
export type ErrorSort = (typeof ERROR_SORTS)[number]

export const ERROR_METRICS = ['events', 'issues', 'people'] as const
export type ErrorMetric = (typeof ERROR_METRICS)[number]

/** Issues the list shows at first, and how many more "Load more" adds. */
export const ISSUES_PAGE = 50

export interface ErrorsState {
  period: ErrorPeriodId
  tab: IssueTab
  sort: ErrorSort
  metric: ErrorMetric
  show: number
  /** One source of the scope, or every source (null). */
  source: string | null
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export function parseErrorsState(
  search: Record<string, string | string[] | undefined>,
): ErrorsState {
  const period = one(search.period)
  const tab = one(search.tab)
  const sort = one(search.sort)
  const metric = one(search.metric)
  const show = Number(one(search.show))
  return {
    period: ERROR_PERIODS.find((p) => p === period) ?? '24h',
    tab: ISSUE_TABS.find((t) => t === tab) ?? 'unresolved',
    sort: ERROR_SORTS.find((s) => s === sort) ?? 'people',
    metric: ERROR_METRICS.find((m) => m === metric) ?? 'events',
    show: Number.isInteger(show) && show > 0 ? Math.min(show, 500) : ISSUES_PAGE,
    source: sourceParam(search.source),
  }
}

/** The address of the list with some of its state changed; defaults stay out of it. */
export function errorsHref(path: string, state: ErrorsState, change: Partial<ErrorsState>): string {
  const next = { ...state, ...change }
  const params = new URLSearchParams()
  if (next.period !== '24h') params.set('period', next.period)
  if (next.tab !== 'unresolved') params.set('tab', next.tab)
  if (next.sort !== 'people') params.set('sort', next.sort)
  if (next.metric !== 'events') params.set('metric', next.metric)
  if (next.show !== ISSUES_PAGE) params.set('show', String(next.show))
  if (next.source) params.set('source', next.source)
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

export interface SortableIssue {
  events: number
  people: number
  first_seen: Date
  last_seen: Date
}

export function sortIssues<T extends SortableIssue>(issues: T[], sort: ErrorSort): T[] {
  const by: Record<ErrorSort, (a: T, b: T) => number> = {
    people: (a, b) => b.people - a.people || b.events - a.events,
    events: (a, b) => b.events - a.events || b.people - a.people,
    newest: (a, b) => b.first_seen.getTime() - a.first_seen.getTime(),
    recent: (a, b) => b.last_seen.getTime() - a.last_seen.getTime(),
  }
  return [...issues].sort((a, b) => by[sort](a, b) || b.last_seen.getTime() - a.last_seen.getTime())
}

/** "TypeError: Cannot read…", or the message alone when there is no type. */
export function issueTitle(issue: { type: string; value: string }): string {
  const value = issue.value.split('\n')[0] ?? ''
  return issue.type ? (value ? `${issue.type}: ${value}` : issue.type) : value || '(no message)'
}

/**
 * The person as people read it: what the app sent, or "anon 3f9a…" for a
 * visitor hash or for an e-mail the ingest kept only as a hash (`h:`).
 */
export function personLabel(person: string): { anonymous: boolean; label: string } {
  if (!person) return { anonymous: true, label: '' }
  if (person.startsWith('v:') || person.startsWith('h:')) {
    return { anonymous: true, label: person.slice(2, 6) }
  }
  return { anonymous: false, label: person }
}
