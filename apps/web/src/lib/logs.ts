import { sourceParam } from './source-scope'
import { TRAFFIC_PERIODS, type TrafficPeriodId } from './traffic'

/**
 * The Logs page, as closed in the Logs canvas: Traffic's periods, the search
 * box and Live, kept in the address so a search can be shared.
 */

export const LOG_PERIODS = TRAFFIC_PERIODS
export type LogPeriodId = TrafficPeriodId

/** Lines the list shows at first, and how many "Load older" adds. */
export const LOG_PAGE = 100

export interface LogsState {
  period: LogPeriodId
  /** What is in the search box. */
  q: string
  /** False when the person switched Live off. */
  live: boolean
  /** One source of the scope, or every source (null). */
  source: string | null
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export function parseLogsState(search: Record<string, string | string[] | undefined>): LogsState {
  const period = one(search.period)
  return {
    period: LOG_PERIODS.find((p) => p === period) ?? '24h',
    q: (one(search.q) ?? '').trim().slice(0, 2000),
    live: one(search.live) !== '0',
    source: sourceParam(search.source),
  }
}

/** The address of the page with some of its state changed; defaults stay out of it. */
export function logsHref(path: string, state: LogsState, change: Partial<LogsState>): string {
  const next = { ...state, ...change }
  const params = new URLSearchParams()
  if (next.period !== '24h') params.set('period', next.period)
  if (next.q) params.set('q', next.q)
  if (!next.live) params.set('live', '0')
  if (next.source) params.set('source', next.source)
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

/** Slices of the histogram: about 90 bars whatever the period. */
export function histogramStep(period: LogPeriodId, lengthMs: number): number {
  if (period === '30d') return 8 * 3600
  if (period === '7d') return 2 * 3600
  // Today and 24 hours: 15 minutes, or 5 early in the day.
  return lengthMs < 6 * 3_600_000 ? 300 : 900
}

/** The three-letter level the list shows, as Seq does. */
export function levelTag(level: string): string {
  switch (level) {
    case 'fatal':
      return 'FTL'
    case 'error':
      return 'ERR'
    case 'warn':
      return 'WRN'
    case 'debug':
      return 'DBG'
    case 'trace':
      return 'TRC'
    default:
      return 'INF'
  }
}

/** A value for the search box: quoted when it has spaces or quotes. */
export function queryValue(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replaceAll('"', '')}"` : value
}

/** "1.2 GB": bytes for the retention estimate. */
export function readableBytes(bytes: number, locale: string): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: units[unit],
    unitDisplay: 'short',
    maximumFractionDigits: value < 10 ? 1 : 0,
  }).format(value)
}
