import type { Bucket } from '@octadash/db'

/** The periods of the Overview and the product page. Custom ranges come later. */
export const PERIODS = ['24h', '7d', '30d'] as const
export type PeriodId = (typeof PERIODS)[number]

const HOUR = 3_600_000
const LENGTH: Record<PeriodId, number> = {
  '24h': 24 * HOUR,
  '7d': 7 * 24 * HOUR,
  '30d': 30 * 24 * HOUR,
}

export interface Period {
  id: PeriodId
  from: Date
  to: Date
  /** The same length right before, for "vs previous 24 hours". */
  previous: { from: Date; to: Date }
  /** Buckets of the big chart. */
  chart: Bucket
  /** Buckets of the small bars and sparklines in each row: about 24 or fewer. */
  row: Bucket
}

export function parsePeriod(value: string | string[] | undefined): PeriodId {
  return PERIODS.find((p) => p === value) ?? '24h'
}

/** The period ending now, and the one before it. */
export function periodOf(id: PeriodId, now: Date): Period {
  const length = LENGTH[id]
  const to = now
  const from = new Date(to.getTime() - length)
  return {
    id,
    from,
    to,
    previous: { from: new Date(from.getTime() - length), to: from },
    chart: id === '30d' ? 'day' : 'hour',
    row: id === '24h' ? 'hour' : 'day',
  }
}

/**
 * Change from the previous period, as a whole percent: +11, −35. Null when
 * there is nothing to compare with (the previous period had none).
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}
