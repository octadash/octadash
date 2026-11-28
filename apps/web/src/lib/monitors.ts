import type { MonitorStats } from '@octadash/db'
import { type FailureKey, failureOf } from '@octadash/uptime/failure'

/** The intervals the monitor form offers, in seconds. */
export const INTERVALS = [30, 60, 120, 300, 600, 1800, 3600, 21_600, 86_400] as const
/** Extra time a heartbeat may be late, in seconds. */
export const GRACES = [0, 60, 300, 900, 1800, 3600] as const

/** "30 s", "5 minutes", "6 hours", in the reader's language. */
export function durationLabel(
  seconds: number,
  t: (key: 'seconds' | 'minutes' | 'hours', values: { count: number }) => string,
): string {
  if (seconds < 60) return t('seconds', { count: seconds })
  if (seconds < 3600) return t('minutes', { count: seconds / 60 })
  return t('hours', { count: seconds / 3600 })
}

export type ProductStatus = 'up' | 'down' | 'unknown' | 'none'

/** The worst state among a product's monitors: one down is enough to call it down. */
export function worstStatus(statuses: ('up' | 'down' | 'unknown')[]): ProductStatus {
  if (statuses.length === 0) return 'none'
  if (statuses.includes('down')) return 'down'
  if (statuses.includes('unknown')) return 'unknown'
  return 'up'
}

export interface ProductUptime {
  status: ProductStatus
  monitors: number
  /** Share of all checks that were up, across the product's monitors. */
  uptime: number | null
  /** The slowest median among the monitors: the one a visitor feels. */
  medianMs: number | null
  /** The certificate closest to expiring. */
  certDays: number | null
}

/** Sums up a product's monitors for a card or an overview row. Paused monitors are left out. */
export function productUptime(
  monitors: { id: string; status: 'up' | 'down' | 'unknown'; paused: boolean }[],
  stats: Map<string, MonitorStats>,
): ProductUptime {
  const active = monitors.filter((m) => !m.paused)
  let checks = 0
  let ups = 0
  let medianMs: number | null = null
  let certDays: number | null = null
  for (const monitor of active) {
    const s = stats.get(monitor.id)
    if (!s) continue
    checks += s.checks
    ups += (s.uptime ?? 0) * s.checks
    if (s.medianMs !== null) medianMs = Math.max(medianMs ?? 0, s.medianMs)
    if (s.certDays !== null) certDays = Math.min(certDays ?? Number.POSITIVE_INFINITY, s.certDays)
  }
  return {
    status: worstStatus(active.map((m) => m.status)),
    monitors: monitors.length,
    uptime: checks > 0 ? ups / checks : null,
    medianMs,
    certDays,
  }
}

/** Turns what a check recorded ("ECONNREFUSED", "HTTP 503") into a sentence. */
export function describeFailure(
  code: string,
  t: (key: FailureKey, values?: Record<string, string | number>) => string,
): string {
  const failure = failureOf(code)
  return t(failure.key, failure.values)
}
