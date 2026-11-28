import {
  bucketStarts,
  convertMinor,
  type FxRates,
  fxRates,
  getOrganizationSettings,
  type LatestPayment,
  latestPayments,
  listConnectionProjects,
  listConnections,
  listProjects,
  mrrAt,
  type PaymentDay,
  paymentDays,
  paymentRates,
  subscriptionChanges,
} from '@octadash/db'
import type { MoneyState } from '@/lib/money'
import { type TrafficPeriod, trafficPeriod } from '@/lib/traffic'
import { services } from './context'

type Project = Awaited<ReturnType<typeof listProjects>>[number]

const DAY = 86_400_000
/** "Failed now": the last hour. */
const NOW_MS = 60 * 60_000

export interface ProductMoney {
  project: { id: string; name: string; slug: string }
  /** In the organization's currency, minor units. */
  mrr: number
  /** MRR change against 30 days ago, in percent. */
  mrrChange: number | null
  today: number
  paying: number
  /** Share of charges failed in the last hour, or null without charges. */
  failedNow: number | null
  churn: number | null
  /** No gateway serves this product. */
  connected: boolean
}

export interface ShownPayment extends LatestPayment {
  product: { name: string; slug: string }
}

export interface MoneyData {
  period: TrafficPeriod
  timeZone: string
  currency: string
  projects: Project[]
  /** Products in scope a gateway serves. */
  connected: number
  totals: {
    revenue: number
    refunded: number
    mrr: number
    started: number
    churn: number | null
    failed: number | null
  }
  previous: {
    revenue: number
    mrr: number
    started: number
    churn: number | null
    failed: number | null
  }
  /** The product failing most in the last hour, for "Acme Pay 38% now". */
  failingNow: { name: string; share: number } | null
  series: { at: Date; revenue: number; mrr: number }[]
  previousSeries: { at: Date; revenue: number; mrr: number }[]
  byProduct: ProductMoney[]
  latest: ShownPayment[]
  /** Currencies with payments but no exchange rate yet: left out of totals. */
  unconverted: string[]
  complete: boolean
}

const dayOf = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)

/** Everything the Money page shows, for every product (null), a group or one product. */
export async function loadMoney(
  orgId: string,
  projectIds: string[] | null,
  state: MoneyState,
  now = new Date(),
): Promise<MoneyData> {
  const { db, clickhouse } = services()
  const [settings, allProjects, links, connections] = await Promise.all([
    getOrganizationSettings(db, orgId),
    listProjects(db, orgId),
    listConnectionProjects(db, orgId),
    listConnections(db, orgId),
  ])
  const { timeZone, currency } = settings
  const period = trafficPeriod(state.period, now, timeZone)
  const projects = allProjects.filter((p) => projectIds === null || projectIds.includes(p.id))
  const ids = projects.map((p) => p.id)
  const connectedIds = new Set(
    links.filter((l) => connections.some((c) => c.id === l.connectionId)).map((l) => l.projectId),
  )

  let complete = true
  const safe = <T>(run: () => Promise<T>, fallback: T) =>
    run().catch(() => {
      complete = false
      return fallback
    })
  const scope = (from: Date, to: Date) => ({ orgId, projectIds: ids, from, to })
  const monthAgo = new Date(now.getTime() - 30 * DAY)
  const [
    rates,
    current,
    before,
    starts,
    previousStarts,
    changes,
    previousChanges,
    hour,
    todayDays,
    latest,
    mrrNow,
  ] = await Promise.all([
    fxRates(
      db,
      dayOf(new Date(period.previous.from.getTime() - 31 * DAY), timeZone),
      dayOf(now, timeZone),
    ),
    safe(
      () => paymentDays(clickhouse, scope(period.from, period.to), timeZone, period.bucket),
      [] as PaymentDay[],
    ),
    safe(
      () =>
        paymentDays(
          clickhouse,
          scope(period.previous.from, period.previous.to),
          timeZone,
          period.bucket,
        ),
      [] as PaymentDay[],
    ),
    safe(
      () => bucketStarts(clickhouse, { from: period.from, to: period.to, timeZone }, period.bucket),
      [] as Date[],
    ),
    safe(
      () =>
        bucketStarts(
          clickhouse,
          { from: period.previous.from, to: period.previous.to, timeZone },
          period.bucket,
        ),
      [] as Date[],
    ),
    safe(() => subscriptionChanges(clickhouse, scope(period.from, period.to)), []),
    safe(
      () => subscriptionChanges(clickhouse, scope(period.previous.from, period.previous.to)),
      [],
    ),
    safe(
      () => paymentRates(clickhouse, new Date(now.getTime() - NOW_MS), { orgId, projectIds: ids }),
      [],
    ),
    safe(
      () =>
        paymentDays(
          clickhouse,
          scope(new Date(Date.parse(`${dayOf(now, timeZone)}T00:00:00Z`) - DAY), now),
          timeZone,
        ),
      [] as PaymentDay[],
    ),
    safe(() => latestPayments(clickhouse, orgId, ids, 20), [] as LatestPayment[]),
    safe(
      () => mrrAt(clickhouse, orgId, ids, [now, monthAgo, period.from, period.previous.from]),
      [],
    ),
  ])

  const unconverted = new Set<string>()
  const convert = (amount: number, from: string, day: string, table: FxRates = rates) => {
    const value = convertMinor(amount, from, currency, day, table)
    if (value === null) {
      if (amount !== 0) unconverted.add(from)
      return 0
    }
    return value
  }
  const today = dayOf(now, timeZone)

  // MRR series: subscriptions alive at each bucket's end.
  const ends = (startsAt: Date[], to: Date) =>
    startsAt.map((_, i) => new Date(Math.min((startsAt[i + 1] ?? to).getTime(), to.getTime())))
  const [mrrSeries, mrrPrevious] = await Promise.all([
    state.metric === 'mrr'
      ? safe(() => mrrAt(clickhouse, orgId, ids, ends(starts, period.to)), [])
      : Promise.resolve([]),
    state.metric === 'mrr'
      ? safe(() => mrrAt(clickhouse, orgId, ids, ends(previousStarts, period.previous.to)), [])
      : Promise.resolve([]),
  ])
  const mrrSum = (points: typeof mrrNow, at: Date, projectId?: string) =>
    points
      .filter((p) => p.at.getTime() === at.getTime() && (!projectId || p.projectId === projectId))
      .reduce((sum, p) => sum + convert(p.mrr, p.currency, today), 0)

  const revenueOf = (rows: PaymentDay[], projectId?: string) =>
    rows
      .filter((r) => !projectId || r.projectId === projectId)
      .reduce((sum, r) => sum + convert(r.paid, r.currency, r.day), 0)
  const series = (startsAt: Date[], rows: PaymentDay[], mrr: typeof mrrNow, to: Date) => {
    const at = ends(startsAt, to)
    return startsAt.map((start, i) => ({
      at: start,
      revenue: revenueOf(rows.filter((r) => r.at.getTime() === start.getTime())),
      mrr: mrrSum(mrr, at[i] as Date),
    }))
  }
  const churnOf = (rows: { atStart: number; ended: number }[]) => {
    const atStart = rows.reduce((n, r) => n + r.atStart, 0)
    return atStart > 0 ? (rows.reduce((n, r) => n + r.ended, 0) / atStart) * 100 : null
  }
  const failedOf = (rows: PaymentDay[]) => {
    const paid = rows.reduce((n, r) => n + r.paidCount, 0)
    const failed = rows.reduce((n, r) => n + r.failedCount, 0)
    return paid + failed > 0 ? (failed / (paid + failed)) * 100 : null
  }

  const byProduct: ProductMoney[] = projects.map((p) => {
    const mine = changes.filter((c) => c.projectId === p.id)
    const rate = hour.find((h) => h.projectId === p.id)
    const mrr = mrrSum(mrrNow, now, p.id)
    const mrrBefore = mrrSum(mrrNow, monthAgo, p.id)
    return {
      project: { id: p.id, name: p.name, slug: p.slug },
      mrr,
      mrrChange: mrrBefore > 0 ? Math.round(((mrr - mrrBefore) / mrrBefore) * 100) : null,
      today: revenueOf(
        todayDays.filter((d) => d.day === today),
        p.id,
      ),
      paying: mrrNow
        .filter((m) => m.at.getTime() === now.getTime() && m.projectId === p.id)
        .reduce((n, m) => n + m.customers, 0),
      failedNow:
        rate && rate.paid + rate.failed > 0
          ? (rate.failed / (rate.paid + rate.failed)) * 100
          : null,
      churn: churnOf(mine),
      connected: connectedIds.has(p.id),
    }
  })
  const worst = byProduct
    .filter((p) => p.failedNow !== null && p.failedNow > 0)
    .sort((a, b) => (b.failedNow ?? 0) - (a.failedNow ?? 0))[0]
  const byId = new Map(allProjects.map((p) => [p.id, p]))

  return {
    period,
    timeZone,
    currency,
    projects,
    connected: projects.filter((p) => connectedIds.has(p.id)).length,
    totals: {
      revenue: revenueOf(current),
      refunded: current.reduce((sum, r) => sum + convert(r.refunded, r.currency, r.day), 0),
      mrr: mrrSum(mrrNow, now),
      started: changes.reduce((n, c) => n + c.started, 0),
      churn: churnOf(changes),
      failed: failedOf(current),
    },
    previous: {
      revenue: revenueOf(before),
      mrr: mrrSum(mrrNow, period.from),
      started: previousChanges.reduce((n, c) => n + c.started, 0),
      churn: churnOf(previousChanges),
      failed: failedOf(before),
    },
    failingNow: worst ? { name: worst.project.name, share: worst.failedNow ?? 0 } : null,
    series: series(starts, current, mrrSeries, period.to),
    previousSeries: series(previousStarts, before, mrrPrevious, period.previous.to),
    byProduct,
    latest: latest.map((p) => {
      const product = byId.get(p.projectId)
      return { ...p, product: { name: product?.name ?? '', slug: product?.slug ?? '' } }
    }),
    unconverted: [...unconverted],
    complete,
  }
}

/** The newest payments of a scope, for the live list. */
export async function loadLatestPayments(
  orgId: string,
  projects: Project[],
): Promise<ShownPayment[]> {
  const { clickhouse } = services()
  const byId = new Map(projects.map((p) => [p.id, p]))
  const latest = await latestPayments(
    clickhouse,
    orgId,
    projects.map((p) => p.id),
    20,
  )
  return latest.map((p) => {
    const product = byId.get(p.projectId)
    return { ...p, product: { name: product?.name ?? '', slug: product?.slug ?? '' } }
  })
}
