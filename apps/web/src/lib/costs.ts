/**
 * The Costs pages, as closed in the Costs canvas. Costs arrive by the day
 * (OpenAI and the cloud publish days), so the periods are this month (the
 * default, what a budget is about), the last 7 days and the last 30.
 */

export const COST_PERIODS = ['month', '7d', '30d'] as const
export type CostPeriodId = (typeof COST_PERIODS)[number]

export interface CostsState {
  period: CostPeriodId
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export function parseCostsState(search: Record<string, string | string[] | undefined>): CostsState {
  const period = one(search.period)
  return { period: COST_PERIODS.find((p) => p === period) ?? 'month' }
}

export function costsHref(path: string, state: CostsState): string {
  return state.period === 'month' ? path : `${path}?period=${state.period}`
}

const DAY = 86_400_000
const ms = (day: string) => Date.parse(`${day}T00:00:00Z`)
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)

/** Every day from `from` to `to`, inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let t = ms(from); t <= ms(to); t += DAY) out.push(iso(t))
  return out
}

/**
 * The days of a period ending `today` ("2026-11-28", in the organization's
 * time zone), and the same number of days before it to compare with. This
 * month compares with the same days of last month.
 */
export function costPeriod(
  id: CostPeriodId,
  today: string,
): { from: string; to: string; previous: { from: string; to: string } } {
  if (id === 'month') {
    const [y, m, d] = today.split('-').map(Number) as [number, number, number]
    const from = `${today.slice(0, 7)}-01`
    const prevStart = new Date(Date.UTC(y, m - 2, 1))
    const prevDays = new Date(Date.UTC(y, m - 1, 0)).getUTCDate()
    const prevEnd = new Date(Date.UTC(y, m - 2, Math.min(d, prevDays)))
    return {
      from,
      to: today,
      previous: { from: iso(prevStart.getTime()), to: iso(prevEnd.getTime()) },
    }
  }
  const n = id === '7d' ? 7 : 30
  const from = iso(ms(today) - (n - 1) * DAY)
  return {
    from,
    to: today,
    previous: { from: iso(ms(from) - n * DAY), to: iso(ms(from) - DAY) },
  }
}

/**
 * Where this month lands: what was spent so far plus the average of the last
 * 7 days for each day left.
 */
export function forecastMonth(spentSoFar: number, lastWeek: number, today: string): number {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return spentSoFar + (lastWeek / 7) * (daysInMonth - d)
}

/** Margin in percent: what is left of revenue after costs; null without revenue. */
export function marginOf(revenue: number, cost: number): number | null {
  return revenue > 0 ? ((revenue - cost) / revenue) * 100 : null
}

/**
 * An amount typed in major units ("1500", "1,500.50", "1.500,50", "49,90")
 * into minor units. The last separator is the decimal one when 1 or 2 digits
 * follow it; the others group thousands. Null when it is not a number.
 */
export function parseAmount(text: string, digits = 2): number | null {
  const clean = text.replace(/[^\d.,-]/g, '')
  if (!/\d/.test(clean) || clean.startsWith('-')) return null
  const last = Math.max(clean.lastIndexOf('.'), clean.lastIndexOf(','))
  const tail = last >= 0 ? clean.slice(last + 1) : ''
  const decimal = last >= 0 && digits > 0 && tail.length >= 1 && tail.length <= 2
  const whole = (decimal ? clean.slice(0, last) : clean).replace(/[.,]/g, '')
  const fraction = decimal ? tail.padEnd(digits, '0').slice(0, digits) : ''
  const value = Number(`${whole || '0'}${fraction ? `.${fraction}` : ''}`)
  return Number.isFinite(value) ? Math.round(value * 10 ** digits) : null
}
