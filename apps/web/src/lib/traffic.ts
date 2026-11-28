import type { Bucket, TrafficDimension, TrafficFilter } from '@octadash/db'

/**
 * The Traffic page, as closed in the Traffic canvas: its periods, the filters
 * people add by clicking rows (kept in the address, so a filtered page can be
 * shared), and the numbers on top that switch the chart.
 */

export const TRAFFIC_PERIODS = ['today', '24h', '7d', '30d'] as const
export type TrafficPeriodId = (typeof TRAFFIC_PERIODS)[number]

export interface TrafficPeriod {
  id: TrafficPeriodId
  from: Date
  to: Date
  previous: { from: Date; to: Date }
  bucket: Bucket
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

export function parseTrafficPeriod(value: string | string[] | undefined): TrafficPeriodId {
  return TRAFFIC_PERIODS.find((p) => p === value) ?? '30d'
}

/** Midnight of `now`'s day in a time zone, as an instant. */
export function startOfDay(now: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(now)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const since = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000
  return new Date(Math.floor((now.getTime() - since) / 1000) * 1000)
}

/** The period ending now and the same length right before it. Today compares with yesterday until this hour. */
export function trafficPeriod(id: TrafficPeriodId, now: Date, timeZone: string): TrafficPeriod {
  const from =
    id === 'today'
      ? startOfDay(now, timeZone)
      : new Date(now.getTime() - (id === '24h' ? DAY : id === '7d' ? 7 * DAY : 30 * DAY))
  const length = now.getTime() - from.getTime()
  const previousFrom =
    id === 'today' ? new Date(from.getTime() - DAY) : new Date(from.getTime() - length)
  return {
    id,
    from,
    to: now,
    previous: { from: previousFrom, to: new Date(previousFrom.getTime() + length) },
    bucket: id === '30d' ? 'day' : 'hour',
  }
}

/** The dimensions a row can filter by, in the order the page shows them. */
export const FILTER_DIMENSIONS = [
  'product',
  'channel',
  'source',
  'campaign',
  'page',
  'entry',
  'country',
  'device',
  'browser',
  'os',
  'screen',
] as const satisfies readonly TrafficDimension[]

const MAX_FILTERS = 6

/** `?f=source:google&f=country:BR` to filters. Unknown dimensions and repeats are dropped. */
export function parseFilters(value: string | string[] | undefined): TrafficFilter[] {
  const list = Array.isArray(value) ? value : value ? [value] : []
  const filters: TrafficFilter[] = []
  for (const item of list) {
    const at = item.indexOf(':')
    if (at < 1) continue
    const dimension = item.slice(0, at) as TrafficFilter['dimension']
    const filterValue = item.slice(at + 1).slice(0, 500)
    if (!(FILTER_DIMENSIONS as readonly string[]).includes(dimension)) continue
    if (filters.some((f) => f.dimension === dimension)) continue
    filters.push({ dimension, value: filterValue })
    if (filters.length === MAX_FILTERS) break
  }
  return filters
}

export const TRAFFIC_METRICS = ['visitors', 'pageviews', 'perVisitor'] as const
export type TrafficMetric = (typeof TRAFFIC_METRICS)[number]

export function parseMetric(value: string | string[] | undefined): TrafficMetric {
  return TRAFFIC_METRICS.find((m) => m === value) ?? 'visitors'
}

/** The page's address with one thing changed: a filter added or removed, the period, the metric. */
export function trafficHref(
  path: string,
  state: { period: TrafficPeriodId; metric: TrafficMetric; filters: TrafficFilter[] },
  change: Partial<{ period: TrafficPeriodId; metric: TrafficMetric; filters: TrafficFilter[] }>,
) {
  const next = { ...state, ...change }
  const params = new URLSearchParams()
  if (next.period !== '30d') params.set('period', next.period)
  if (next.metric !== 'visitors') params.set('metric', next.metric)
  for (const f of next.filters) params.append('f', `${f.dimension}:${f.value}`)
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

/** Filters with these added (a row of a page adds its product too); one per dimension. */
export function withFilters(filters: TrafficFilter[], added: TrafficFilter[]) {
  const dims = new Set(added.map((f) => f.dimension))
  return [...filters.filter((f) => !dims.has(f.dimension)), ...added]
}

/** A flag from a country code: two regional indicator letters. Empty for unknown codes. */
export function flagOf(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

/** Share of a total, as a whole percent that never shows 0 for something that is there. */
export function shareOf(value: number, total: number) {
  if (total <= 0 || value <= 0) return 0
  return Math.max(1, Math.round((value / total) * 100))
}
