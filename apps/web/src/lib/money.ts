import { TRAFFIC_PERIODS, type TrafficPeriodId } from './traffic'

/**
 * The Money pages, as closed in the Money canvas: Traffic's periods and the
 * number the chart shows, kept in the address.
 */

export const MONEY_PERIODS = TRAFFIC_PERIODS
export type MoneyPeriodId = TrafficPeriodId

/** Numbers the chart can draw; the others are shares or counts for the period. */
export const MONEY_METRICS = ['revenue', 'mrr'] as const
export type MoneyMetric = (typeof MONEY_METRICS)[number]

export interface MoneyState {
  period: MoneyPeriodId
  metric: MoneyMetric
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

export function parseMoneyState(search: Record<string, string | string[] | undefined>): MoneyState {
  const period = one(search.period)
  const metric = one(search.metric)
  return {
    period: MONEY_PERIODS.find((p) => p === period) ?? '30d',
    metric: MONEY_METRICS.find((m) => m === metric) ?? 'revenue',
  }
}

export function moneyHref(path: string, state: MoneyState, change: Partial<MoneyState>): string {
  const next = { ...state, ...change }
  const params = new URLSearchParams()
  if (next.period !== '30d') params.set('period', next.period)
  if (next.metric !== 'revenue') params.set('metric', next.metric)
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

/** Digits after the point of a currency: 2 for USD, 0 for JPY. */
export function digitsOf(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

/** "$41,820" or "R$ 129,90": minor units in a currency. Whole units when `whole`. */
export function formatMoney(
  minor: number,
  currency: string,
  locale: string,
  whole = false,
): string {
  const digits = digitsOf(currency)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: whole ? 0 : digits,
    minimumFractionDigits: whole ? 0 : digits,
  }).format(minor / 10 ** digits)
}

/** A share as a whole percent, or null without a base. */
export function shareOf(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null
}

/** Percent points between two shares, rounded to one decimal; null when either is missing. */
export function pointsBetween(now: number | null, before: number | null): number | null {
  if (now === null || before === null) return null
  return Math.round((now - before) * 10) / 10
}

/** Webhook tokens: 32 hex characters, made by the page and kept by the connection. */
export function isWebhookToken(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value)
}
