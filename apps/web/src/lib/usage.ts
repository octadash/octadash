import { TRAFFIC_PERIODS, type TrafficPeriodId } from './traffic'

/**
 * The Product usage pages, as closed in the Product usage canvas: Traffic's
 * periods, the number that switches the chart, the event search and how many
 * events the list shows, all kept in the address.
 */

export const USAGE_PERIODS = TRAFFIC_PERIODS
export type UsagePeriodId = TrafficPeriodId

export const USAGE_METRICS = ['active', 'signups', 'keyEvents'] as const
export type UsageMetric = (typeof USAGE_METRICS)[number]

/** Events the list shows at first, and how many more "Show more" adds. */
export const EVENTS_PAGE = 25

export interface UsageState {
  period: UsagePeriodId
  metric: UsageMetric
  /** Part of an event name, from the search box. */
  q: string
  show: number
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export function parseUsageState(search: Record<string, string | string[] | undefined>): UsageState {
  const period = one(search.period)
  const metric = one(search.metric)
  const show = Number(one(search.show))
  return {
    period: USAGE_PERIODS.find((p) => p === period) ?? '7d',
    metric: USAGE_METRICS.find((m) => m === metric) ?? 'active',
    q: (one(search.q) ?? '').trim().slice(0, 100),
    show: Number.isInteger(show) && show > 0 ? Math.min(show, 200) : EVENTS_PAGE,
  }
}

/** The address of the page with some of its state changed; defaults stay out of it. */
export function usageHref(path: string, state: UsageState, change: Partial<UsageState>): string {
  const next = { ...state, ...change }
  const params = new URLSearchParams()
  if (next.period !== '7d') params.set('period', next.period)
  if (next.metric !== 'active') params.set('metric', next.metric)
  if (next.q) params.set('q', next.q)
  if (next.show !== EVENTS_PAGE) params.set('show', String(next.show))
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

const DAY = 86_400_000

/**
 * The earlier periods that say what is normal for an event: the same stretch
 * one to four weeks before (so a Monday is read against Mondays), or the four
 * periods before for a month.
 */
export function normalWindows(period: { from: Date; to: Date }): { from: Date; to: Date }[] {
  const length = period.to.getTime() - period.from.getTime()
  const step = Math.max(7 * DAY, Math.ceil(length / (7 * DAY)) * 7 * DAY)
  return [1, 2, 3, 4].map((k) => ({
    from: new Date(period.from.getTime() - k * step),
    to: new Date(period.to.getTime() - k * step),
  }))
}

export type NormalStatus = 'expected' | 'below' | 'above' | 'new' | 'few' | 'stopped'

export interface Normal {
  status: NormalStatus
  /** How far from expected, in percent, for below and above. */
  percent: number
  expected: number
}

/** Under this many expected and seen, a change says nothing. */
const FEW = 5

/**
 * "Normal?" for one event: its count against the mean of the earlier
 * periods. More than 30% under or 50% over is out of normal. A key event with
 * an open "Key event stopped" reads as stopped whatever the numbers say.
 */
export function normalOf(count: number, baseline: number[], stopped = false): Normal {
  const expected = baseline.length > 0 ? baseline.reduce((a, b) => a + b, 0) / baseline.length : 0
  if (stopped) return { status: 'stopped', percent: 100, expected }
  if (expected === 0) return { status: count > 0 ? 'new' : 'few', percent: 0, expected }
  if (expected < FEW && count < FEW) return { status: 'few', percent: 0, expected }
  const ratio = count / expected
  const percent = Math.round(Math.abs(ratio - 1) * 100)
  if (ratio < 0.7) return { status: 'below', percent, expected }
  if (ratio > 1.5) return { status: 'above', percent, expected }
  return { status: 'expected', percent, expected }
}

/** Steps of a funnel as typed, one per line or comma: trimmed, no blanks, at most 8. */
export function parseSteps(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((s) => s.slice(0, 200))
}
