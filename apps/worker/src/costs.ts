import type { Logger } from '@octadash/core'
import { decryptSecret } from '@octadash/core'
import {
  type ConnectionRow,
  type CostDay,
  costDayTotals,
  type Db,
  listAllConnections,
  listCostShares,
  markConnection,
  saveCostDays,
  saveCostHours,
  trimCostHours,
} from '@octadash/db'
import { type CostItem, type CostProvider, costProvider } from '@octadash/integrations'
import type { PgBoss } from 'pg-boss'

export const COST_QUEUES = {
  /** Every 5 minutes: imports new connections and reads the providers that are due. */
  sync: 'costs-sync',
} as const

const DAY = 86_400_000
const HOUR = 3_600_000
/** Days of history a new connection imports: enough for 30 days against the 30 before, and a week of baseline. */
export const IMPORT_DAYS = 90
/** Days read again on each sync: providers revise recent days. */
const LOOKBACK_DAYS = 3
/** A failed first import waits this long before trying again. */
const RETRY_IMPORT_MS = 15 * 60_000

export interface CostsDeps {
  db: Db
  secret: string
  log: Logger
  fetch?: typeof fetch
  now?: () => Date
  provider?: (id: string) => CostProvider | undefined
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY

/** What a connection needs now: its first import, a read, or nothing. */
export function costWork(
  row: Pick<ConnectionRow, 'status' | 'imported_at' | 'synced_at'>,
  every: number,
  now: Date,
): 'import' | 'sync' | null {
  const tried = row.synced_at?.getTime() ?? 0
  if (!row.imported_at) {
    if (row.status === 'failing' && now.getTime() - tried < RETRY_IMPORT_MS) return null
    return 'import'
  }
  return now.getTime() - tried >= every * 60_000 ? 'sync' : null
}

/** Items summed per day, tag and line item, as `cost_day` keeps them. */
export function costDays(items: CostItem[]): Omit<CostDay, 'connectionId'>[] {
  const byKey = new Map<string, Omit<CostDay, 'connectionId'>>()
  for (const item of items) {
    const day = isoDay(item.at.getTime())
    const key = `${day}\u0000${item.tag}\u0000${item.lineItem}\u0000${item.currency}`
    const row = byKey.get(key)
    if (row) row.amount += item.amount
    else
      byKey.set(key, {
        day,
        tag: item.tag,
        lineItem: item.lineItem,
        amount: item.amount,
        currency: item.currency,
      })
  }
  return [...byKey.values()]
}

/** Hourly items summed per hour and tag, as `cost_hour` keeps them. */
export function costHours(items: CostItem[]) {
  const byKey = new Map<string, { hour: Date; tag: string; amount: number; currency: string }>()
  for (const item of items) {
    if (item.hours !== 1) continue
    const key = `${item.at.getTime()}\u0000${item.tag}`
    const row = byKey.get(key)
    if (row) row.amount += item.amount
    else
      byKey.set(key, { hour: item.at, tag: item.tag, amount: item.amount, currency: item.currency })
  }
  return [...byKey.values()]
}

/**
 * The growth of today's total per tag since the last read: the spend of the
 * hours between reads, for providers that only give days. Never negative (a
 * provider's correction is not a refund).
 */
export function growth(
  before: ReadonlyMap<string, number>,
  today: Omit<CostDay, 'connectionId'>[],
): Map<string, number> {
  const after = new Map<string, number>()
  for (const row of today) after.set(row.tag, (after.get(row.tag) ?? 0) + row.amount)
  const out = new Map<string, number>()
  for (const [tag, amount] of after) {
    const grew = amount - (before.get(tag) ?? 0)
    if (grew > 0.0001) out.set(tag, grew)
  }
  return out
}

export function connectionKey(row: { secrets: string }, secret: string): string {
  const stored = JSON.parse(row.secrets) as Record<string, string>
  return stored.key ? decryptSecret(stored.key, secret) : ''
}

export function createCosts(deps: CostsDeps) {
  const now = deps.now ?? (() => new Date())
  const fetcher = deps.fetch ?? fetch
  const providerOf = deps.provider ?? costProvider

  async function readConnection(row: ConnectionRow, provider: CostProvider) {
    const work = costWork(row, provider.every, now())
    if (!work) return
    const started = now()
    const from =
      dayStart(started.getTime()) - (work === 'import' ? IMPORT_DAYS : LOOKBACK_DAYS) * DAY
    const today = isoDay(started.getTime())
    try {
      const items: CostItem[] = []
      for await (const page of provider.costs(
        { key: connectionKey(row, deps.secret) },
        { fetch: fetcher },
        new Date(from),
        started,
      ))
        items.push(...page)
      const days = costDays(items)
      const before = work === 'sync' ? await costDayTotals(deps.db, row.id, today) : null
      const covered: string[] = []
      for (let t = from; t <= dayStart(started.getTime()); t += DAY) covered.push(isoDay(t))
      await saveCostDays(deps.db, row.org_id, row.id, covered, days)
      const hours = costHours(items)
      if (hours.length > 0) {
        await saveCostHours(deps.db, row.org_id, row.id, hours, 'set')
      } else if (before) {
        // Days only: what today's total grew since the last read is this hour's spend.
        const grew = growth(
          before,
          days.filter((d) => d.day === today),
        )
        const hour = new Date(Math.floor(started.getTime() / HOUR) * HOUR)
        const currency = days.find((d) => d.day === today)?.currency ?? 'USD'
        await saveCostHours(
          deps.db,
          row.org_id,
          row.id,
          [...grew].map(([tag, amount]) => ({ hour, tag, amount, currency })),
          'add',
        )
      }
      await markConnection(deps.db, row.id, {
        status: 'ok',
        lastError: null,
        syncedAt: started,
        ...(work === 'import' ? { importedAt: now() } : {}),
      })
      deps.log.info(
        { connection: row.id, provider: provider.id, work, items: items.length },
        'costs read',
      )
    } catch (err) {
      const message = (err as Error).message.slice(0, 500)
      deps.log.warn(
        { connection: row.id, provider: provider.id, err: message },
        'costs read failed',
      )
      await markConnection(deps.db, row.id, {
        status: 'failing',
        lastError: message,
        syncedAt: started,
      })
    }
  }

  return {
    /** Reads every provider connection that is due and some product uses. */
    async sync() {
      const [connections, shares] = await Promise.all([
        listAllConnections(deps.db),
        listCostShares(deps.db, null),
      ])
      const used = new Set(shares.map((s) => s.connectionId))
      for (const row of connections) {
        const provider = providerOf(row.integration)
        if (!provider || !used.has(row.id)) continue
        await readConnection(row, provider)
      }
      await trimCostHours(deps.db, new Date(now().getTime() - 14 * DAY))
    },
  }
}

export async function registerCostJobs(boss: PgBoss, costs: ReturnType<typeof createCosts>) {
  await boss.createQueue(COST_QUEUES.sync, { policy: 'exclusive', expireInSeconds: 3600 })
  await boss.schedule(COST_QUEUES.sync, '*/5 * * * *')
  await boss.work(COST_QUEUES.sync, async () => {
    await costs.sync()
  })
}
