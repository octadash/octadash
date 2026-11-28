import {
  convertMinor,
  fixedCostDays,
  fxRates,
  getOrganizationSettings,
  listConnections,
  listCostBudgets,
  listCostDays,
  listCostShares,
  listCostSplitHistory,
  listFixedCosts,
  listProjects,
  type PaymentDay,
  paymentDays,
  splitOn,
  trafficSeriesByProduct,
} from '@octadash/db'
import { type CostShare, costProvider, type SplitMode, splitCost } from '@octadash/integrations'
import { type CostsState, costPeriod, daysBetween, forecastMonth, marginOf } from '@/lib/costs'
import { services } from './context'

type Project = Awaited<ReturnType<typeof listProjects>>[number]

const DAY = 86_400_000

export interface ProductCost {
  project: { id: string; name: string; slug: string }
  cost: number
  revenue: number
  margin: number | null
  /** AI spend today against its daily average of the last 7 days, when 1.5× or more. */
  aiTimes: number | null
  /** No connection gives this product a part. */
  connected: boolean
  /** This month's forecast against the product's budget. */
  budget: 'over' | 'near' | null
}

export interface ProviderCost {
  id: string
  name: string
  /** openai, anthropic or fixed. */
  provider: string
  /** In scope, in the period. */
  amount: number
  /** Not given to any product. */
  unassigned: number
  /** How it is read: hourly, daily, monthly, yearly. */
  every: 'hour' | 'day' | 'month' | 'year'
  status: string
  syncedAt: Date | null
}

export interface CostsData {
  timeZone: string
  currency: string
  projects: Project[]
  /** Products in scope with a part of some cost. */
  connected: number
  period: { from: string; to: string; previous: { from: string; to: string } }
  totals: { spend: number; revenue: number; margin: number | null }
  previous: { spend: number; margin: number | null }
  month: {
    spent: number
    forecast: number
    /** The budgets of the products in scope, against the forecast of those products. */
    budget: {
      amount: number
      forecast: number
      /** Percent of the budget at which the forecast warns, weighted by budget. */
      warn: number
      products: number
      /** Every product with a cost has a budget, so the totals compare. */
      all: boolean
    } | null
  }
  ai: {
    today: number
    average: number
    /** The product furthest above its own AI average today. */
    top: { name: string; times: number } | null
  }
  series: { day: string; spend: number }[]
  previousSeries: { day: string; spend: number }[]
  byProduct: ProductCost[]
  byProvider: ProviderCost[]
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

/**
 * Everything the Costs page shows. Each provider's day is divided between
 * products by the connection's shares and split, then converted into the
 * organization's currency at that day's rate.
 */
export async function loadCosts(
  orgId: string,
  projectIds: string[] | null,
  state: CostsState,
  now = new Date(),
): Promise<CostsData> {
  const { db, clickhouse } = services()
  const [settings, allProjects, connections, shares, history, fixed, budgets] = await Promise.all([
    getOrganizationSettings(db, orgId),
    listProjects(db, orgId),
    listConnections(db, orgId),
    listCostShares(db, orgId),
    listCostSplitHistory(db, orgId),
    listFixedCosts(db, orgId),
    listCostBudgets(db, orgId),
  ])
  const { timeZone, currency } = settings
  const today = dayOf(now, timeZone)
  const period = costPeriod(state.period, today)
  const month = costPeriod('month', today)
  const weekFrom = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * DAY).toISOString().slice(0, 10)
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - DAY).toISOString().slice(0, 10)
  const from = [period.previous.from, month.from, weekFrom].sort()[0] as string

  const projects = allProjects.filter((p) => projectIds === null || projectIds.includes(p.id))
  const inScope = new Set(projects.map((p) => p.id))
  const costConnections = connections.filter(
    (c) => c.integration === 'fixed' || costProvider(c.integration),
  )
  const sharesOf = new Map<string, CostShare[]>()
  for (const s of shares) {
    const list = sharesOf.get(s.connectionId) ?? []
    list.push(s)
    sharesOf.set(s.connectionId, list)
  }
  // Each connection's division day by day: a change holds from its day on.
  const versionsOf = new Map<string, typeof history>()
  for (const v of history) {
    const list = versionsOf.get(v.connectionId) ?? []
    list.push(v)
    versionsOf.set(v.connectionId, list)
  }
  const divisionOn = (connectionId: string, day: string) => {
    const version = splitOn(versionsOf.get(connectionId) ?? [], day)
    if (version) return { split: version.split as SplitMode, shares: version.shares as CostShare[] }
    return {
      split: (costConnections.find((c) => c.id === connectionId)?.split ?? 'equal') as SplitMode,
      shares: sharesOf.get(connectionId) ?? [],
    }
  }
  const usesTraffic =
    costConnections.some((c) => c.split === 'traffic') || history.some((v) => v.split === 'traffic')

  let complete = true
  const safe = <T>(run: () => Promise<T>, fallback: T) =>
    run().catch(() => {
      complete = false
      return fallback
    })
  const ids = projects.map((p) => p.id)
  const periodDates = (a: string, b: string) => ({
    orgId,
    projectIds: ids,
    from: new Date(`${a}T00:00:00Z`),
    to: new Date(Date.parse(`${b}T00:00:00Z`) + DAY),
  })
  const [rates, days, traffic, revenueNow, revenueBefore] = await Promise.all([
    fxRates(db, from, today),
    listCostDays(db, orgId, from, today),
    usesTraffic
      ? safe(
          () =>
            trafficSeriesByProduct(
              clickhouse,
              {
                orgId,
                projectIds: null,
                from: new Date(`${from}T00:00:00Z`),
                to: now,
                timeZone,
              },
              'day',
            ),
          new Map(),
        )
      : Promise.resolve(new Map()),
    safe(
      () => paymentDays(clickhouse, periodDates(period.from, period.to), timeZone),
      [] as PaymentDay[],
    ),
    safe(
      () =>
        paymentDays(clickhouse, periodDates(period.previous.from, period.previous.to), timeZone),
      [] as PaymentDay[],
    ),
  ])

  const visitors = new Map<string, Map<string, number>>()
  for (const [projectId, points] of traffic as Map<string, { at: Date; visitors: number }[]>) {
    for (const point of points) {
      const day = dayOf(point.at, timeZone)
      const byProduct = visitors.get(day) ?? new Map<string, number>()
      byProduct.set(projectId, point.visitors)
      visitors.set(day, byProduct)
    }
  }

  const unconverted = new Set<string>()
  const convert = (amount: number, from: string, day: string) => {
    const value = convertMinor(amount, from, currency, day, rates)
    if (value === null) {
      if (amount !== 0) unconverted.add(from)
      return 0
    }
    return value
  }

  // Every cost row as it lands: connection, day, product (or null), amount in the org currency.
  interface Landed {
    connectionId: string
    day: string
    projectId: string | null
    amount: number
  }
  const landed: Landed[] = []
  const land = (connectionId: string, day: string, tag: string, amount: number, from: string) => {
    const value = convert(amount, from, day)
    if (!value) return
    const division = divisionOn(connectionId, day)
    const parts = splitCost(
      { tag, amount: value },
      division.shares,
      division.split,
      visitors.get(day),
    )
    let given = 0
    for (const [projectId, part] of parts) {
      landed.push({ connectionId, day, projectId, amount: part })
      given += part
    }
    if (value - given > 0.0001)
      landed.push({ connectionId, day, projectId: null, amount: value - given })
  }
  const known = new Set(costConnections.map((c) => c.id))
  for (const row of days)
    if (known.has(row.connectionId))
      land(row.connectionId, row.day, row.tag, row.amount, row.currency)
  for (const bill of fixed) {
    if (!known.has(bill.connectionId)) continue
    for (const d of fixedCostDays(bill, from, today))
      land(bill.connectionId, d.day, '', d.amount, bill.currency)
  }

  const isAi = (connectionId: string) =>
    costProvider(costConnections.find((c) => c.id === connectionId)?.integration ?? '')?.kind ===
    'ai'
  const within = (day: string, a: string, b: string) => day >= a && day <= b
  const sum = (filter: (l: Landed) => boolean) =>
    landed.reduce((n, l) => (filter(l) ? n + l.amount : n), 0)
  const mine = (l: Landed) => l.projectId !== null && inScope.has(l.projectId)

  const spend = sum((l) => mine(l) && within(l.day, period.from, period.to))
  const previousSpend = sum(
    (l) => mine(l) && within(l.day, period.previous.from, period.previous.to),
  )
  const revenueOf = (rows: PaymentDay[], projectId?: string) =>
    rows
      .filter((r) => !projectId || r.projectId === projectId)
      .reduce((n, r) => n + convert(r.paid - r.refunded, r.currency, r.day), 0)
  const revenue = revenueOf(revenueNow)
  const previousRevenue = revenueOf(revenueBefore)

  const forecastOf = (filter: (l: Landed) => boolean) =>
    forecastMonth(
      sum((l) => filter(l) && within(l.day, month.from, today)),
      sum((l) => filter(l) && within(l.day, weekFrom, yesterday)),
      today,
    )
  const monthSpent = sum((l) => mine(l) && within(l.day, month.from, today))
  const scopedBudgets = budgets.filter((b) => inScope.has(b.projectId))
  const budgeted = new Set(scopedBudgets.map((b) => b.projectId))
  const budgetAmount = scopedBudgets.reduce((n, b) => n + b.amount, 0)
  const budget =
    scopedBudgets.length > 0
      ? {
          amount: budgetAmount,
          forecast: forecastOf((l) => l.projectId !== null && budgeted.has(l.projectId)),
          warn: Math.round(scopedBudgets.reduce((n, b) => n + b.warn * b.amount, 0) / budgetAmount),
          products: scopedBudgets.length,
          all: projects.every(
            (p) => budgeted.has(p.id) || !landed.some((l) => l.projectId === p.id),
          ),
        }
      : null
  const budgetState = (projectId: string) => {
    const b = scopedBudgets.find((x) => x.projectId === projectId)
    if (!b) return null
    const f = forecastOf((l) => l.projectId === projectId)
    return f > b.amount ? 'over' : f >= (b.amount * b.warn) / 100 ? 'near' : null
  }

  const aiOf = (projectId: string | null, a: string, b: string) =>
    sum(
      (l) =>
        isAi(l.connectionId) &&
        within(l.day, a, b) &&
        (projectId ? l.projectId === projectId : mine(l)),
    )
  const aiToday = aiOf(null, today, today)
  const aiAverage = aiOf(null, weekFrom, yesterday) / 7
  const timesOf = (projectId: string) => {
    const avg = aiOf(projectId, weekFrom, yesterday) / 7
    const now = aiOf(projectId, today, today)
    return avg > 0 ? now / avg : null
  }

  const connectedIds = new Set(shares.map((s) => s.projectId))
  const byProduct: ProductCost[] = projects.map((p) => {
    const cost = sum((l) => l.projectId === p.id && within(l.day, period.from, period.to))
    const rev = revenueOf(revenueNow, p.id)
    const times = timesOf(p.id)
    return {
      project: { id: p.id, name: p.name, slug: p.slug },
      cost,
      revenue: rev,
      margin: marginOf(rev, cost),
      aiTimes: times !== null && times >= 1.5 ? Math.round(times * 10) / 10 : null,
      connected: connectedIds.has(p.id),
      budget: budgetState(p.id),
    }
  })
  const top = byProduct
    .filter((p) => p.aiTimes !== null)
    .sort((a, b) => (b.aiTimes ?? 0) - (a.aiTimes ?? 0))[0]

  const byProvider: ProviderCost[] = costConnections
    .filter((c) => (sharesOf.get(c.id) ?? []).some((s) => inScope.has(s.projectId)))
    .map((c) => {
      const provider = costProvider(c.integration)
      const bill = fixed.find((f) => f.connectionId === c.id)
      return {
        id: c.id,
        name: c.name,
        provider: c.integration,
        amount: sum(
          (l) => l.connectionId === c.id && mine(l) && within(l.day, period.from, period.to),
        ),
        unassigned:
          projectIds === null
            ? sum(
                (l) =>
                  l.connectionId === c.id &&
                  l.projectId === null &&
                  within(l.day, period.from, period.to),
              )
            : 0,
        every: (provider
          ? provider.every <= 60
            ? 'hour'
            : 'day'
          : (bill?.every ?? 'month')) as ProviderCost['every'],
        status: provider ? c.status : 'ok',
        syncedAt: provider ? c.synced_at : null,
      }
    })
    .sort((a, b) => b.amount - a.amount)

  const series = (a: string, b: string) =>
    daysBetween(a, b).map((day) => ({
      day,
      spend: sum((l) => mine(l) && l.day === day),
    }))

  return {
    timeZone,
    currency,
    projects,
    connected: projects.filter((p) => connectedIds.has(p.id)).length,
    period,
    totals: { spend, revenue, margin: marginOf(revenue, spend) },
    previous: { spend: previousSpend, margin: marginOf(previousRevenue, previousSpend) },
    month: {
      spent: monthSpent,
      forecast: forecastOf(mine),
      budget,
    },
    ai: {
      today: aiToday,
      average: aiAverage,
      top: top ? { name: top.project.name, times: top.aiTimes ?? 0 } : null,
    },
    series: series(period.from, period.to),
    previousSeries: series(period.previous.from, period.previous.to),
    byProduct,
    byProvider,
    unconverted: [...unconverted],
    complete,
  }
}
