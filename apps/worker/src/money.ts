import type { Logger } from '@octadash/core'
import { decryptSecret } from '@octadash/core'
import {
  type ConnectionRow,
  type createClickHouse,
  type Db,
  latestFxDay,
  listAllConnections,
  listConnectionProjects,
  markConnection,
  saveFxRates,
  storeMoney,
} from '@octadash/db'
import {
  type MoneyConfig,
  type MoneyGateway,
  matchProject,
  moneyGateway,
  type ProductRule,
} from '@octadash/integrations'
import type { PgBoss } from 'pg-boss'

export const MONEY_QUEUES = {
  /** Every minute: imports new connections and reads the gateways that are due. */
  sync: 'money-sync',
  /** Daily exchange rates. */
  fx: 'money-fx',
} as const

/** Months of history a new connection imports. */
export const IMPORT_MONTHS = 12
/** How often payments are read when no webhook arrives. */
const SYNC_MS = 5 * 60_000
/** Payments read again on each sync, so a refund or late failure is seen. */
const LOOKBACK_MS = 3 * 86_400_000
/** Subscriptions are listed whole, so less often. */
const SUBSCRIPTIONS_MS = 60 * 60_000
/** A failed first import waits this long before trying again. */
const RETRY_IMPORT_MS = 15 * 60_000
/** Exchange rates: the European Central Bank's, through Frankfurter (free, no key). */
const FX_URL = 'https://api.frankfurter.dev/v1'
const FX_HISTORY_DAYS = 400

export interface MoneyDeps {
  db: Db
  clickhouse: ReturnType<typeof createClickHouse>
  secret: string
  log: Logger
  fetch?: typeof fetch
  now?: () => Date
  gateway?: (id: string) => MoneyGateway | undefined
}

/** The key and webhook secret of a connection, decrypted. */
export function connectionConfig(row: { secrets: string }, secret: string): MoneyConfig {
  const stored = JSON.parse(row.secrets) as Record<string, string>
  return {
    key: stored.key ? decryptSecret(stored.key, secret) : '',
    webhookSecret: stored.webhookSecret ? decryptSecret(stored.webhookSecret, secret) : undefined,
  }
}

/** What a connection needs now: its first import, a sync, or nothing. */
export function moneyWork(
  row: Pick<ConnectionRow, 'status' | 'imported_at' | 'synced_at' | 'subscriptions_synced_at'>,
  now: Date,
): { kind: 'import' } | { kind: 'sync'; since: Date; subscriptions: boolean } | null {
  if (!row.imported_at) {
    // A failed import (a wrong key) tries again every 15 minutes, not every minute.
    const tried = row.synced_at?.getTime() ?? 0
    if (row.status === 'failing' && now.getTime() - tried < RETRY_IMPORT_MS) return null
    return { kind: 'import' }
  }
  const synced = row.synced_at?.getTime() ?? 0
  const subscriptions =
    now.getTime() - (row.subscriptions_synced_at?.getTime() ?? 0) >= SUBSCRIPTIONS_MS
  if (now.getTime() - synced < SYNC_MS && !subscriptions) return null
  return {
    kind: 'sync',
    since: new Date(Math.min(synced, now.getTime()) - LOOKBACK_MS),
    subscriptions,
  }
}

/** Every day from `from` to `to`, each with the last rates published by then. */
export function fillRates(
  published: Record<string, Record<string, number>>,
  from: string,
  to: string,
): { day: string; currency: string; perUsd: number }[] {
  const out: { day: string; currency: string; perUsd: number }[] = []
  const days = Object.keys(published).sort()
  let current: Record<string, number> | undefined
  for (const d of days) if (d < from) current = published[d]
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += 86_400_000
  ) {
    const day = new Date(t).toISOString().slice(0, 10)
    current = published[day] ?? current
    if (!current) continue
    for (const [currency, perUsd] of Object.entries(current)) out.push({ day, currency, perUsd })
    out.push({ day, currency: 'USD', perUsd: 1 })
  }
  return out
}

export function createMoney(deps: MoneyDeps) {
  const now = deps.now ?? (() => new Date())
  const fetcher = deps.fetch ?? fetch
  const gatewayOf = deps.gateway ?? moneyGateway

  async function readConnection(row: ConnectionRow, rules: ProductRule[]) {
    const gateway = gatewayOf(row.integration)
    if (!gateway) return
    const work = moneyWork(row, now())
    if (!work) return
    const started = now()
    const config = connectionConfig(row, deps.secret)
    const ctx = { fetch: fetcher }
    const target = { orgId: row.org_id, connectionId: row.id, gateway: gateway.id }
    const projectOf = (item: { products: string[]; tag: string }) => matchProject(item, rules)
    const since =
      work.kind === 'import'
        ? new Date(started.getTime() - IMPORT_MONTHS * 30.5 * 86_400_000)
        : work.since
    try {
      let payments = 0
      for await (const page of gateway.payments(config, ctx, since)) {
        payments += (
          await storeMoney(
            deps.clickhouse,
            target,
            projectOf,
            { payments: page, subscriptions: [] },
            now(),
          )
        ).payments
      }
      let subscriptions = 0
      if (work.kind === 'import' || work.subscriptions) {
        for await (const page of gateway.subscriptions(config, ctx)) {
          subscriptions += (
            await storeMoney(
              deps.clickhouse,
              target,
              projectOf,
              { payments: [], subscriptions: page },
              now(),
            )
          ).subscriptions
        }
      }
      await markConnection(deps.db, row.id, {
        status: 'ok',
        lastError: null,
        syncedAt: started,
        ...(work.kind === 'import' || work.subscriptions ? { subscriptionsSyncedAt: started } : {}),
        ...(work.kind === 'import' ? { importedAt: now() } : {}),
      })
      deps.log.info(
        { connection: row.id, gateway: gateway.id, work: work.kind, payments, subscriptions },
        'money read',
      )
    } catch (err) {
      const message = (err as Error).message.slice(0, 500)
      deps.log.warn({ connection: row.id, gateway: gateway.id, err: message }, 'money read failed')
      // Either waits its turn: a sync the next 5 minutes, an import 15.
      await markConnection(deps.db, row.id, {
        status: 'failing',
        lastError: message,
        syncedAt: started,
      })
    }
  }

  return {
    /** Reads every connection that is due, one after the other. */
    async sync() {
      const [connections, projects] = await Promise.all([
        listAllConnections(deps.db),
        listConnectionProjects(deps.db, null),
      ])
      for (const row of connections) {
        const rules = projects
          .filter((p) => p.connectionId === row.id)
          .map((p) => ({ projectId: p.projectId, rule: p.rule }))
        if (rules.length === 0) continue
        await readConnection(row, rules)
      }
    },

    /** Fetches the rates since the last day saved (or the last 400 days), filling every day. */
    async fx() {
      const today = now().toISOString().slice(0, 10)
      const last = await latestFxDay(deps.db)
      if (last === today) return
      const from = last
        ? new Date(Date.parse(`${last}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
        : new Date(now().getTime() - FX_HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10)
      // A few days before `from`, so a weekend at the start has the Friday before it.
      const ask = new Date(Date.parse(`${from}T00:00:00Z`) - 7 * 86_400_000)
        .toISOString()
        .slice(0, 10)
      const response = await fetcher(`${FX_URL}/${ask}..${today}?base=USD`)
      if (!response.ok) throw new Error(`exchange rates: HTTP ${response.status}`)
      const body = (await response.json()) as { rates: Record<string, Record<string, number>> }
      const rows = fillRates(body.rates, from, today)
      await saveFxRates(deps.db, rows)
      deps.log.info({ from, to: today, rows: rows.length }, 'exchange rates saved')
    },
  }
}

export async function registerMoneyJobs(
  boss: PgBoss,
  money: ReturnType<typeof createMoney>,
  log: Logger,
) {
  await boss.createQueue(MONEY_QUEUES.sync, { policy: 'exclusive', expireInSeconds: 3600 })
  await boss.schedule(MONEY_QUEUES.sync, '* * * * *')
  await boss.work(MONEY_QUEUES.sync, async () => {
    await money.sync()
  })
  await boss.createQueue(MONEY_QUEUES.fx, { policy: 'exclusive' })
  // Every 6 hours: the ECB publishes around 16:00 CET; a failed fetch tries again soon.
  await boss.schedule(MONEY_QUEUES.fx, '23 */6 * * *')
  await boss.work(MONEY_QUEUES.fx, async () => {
    await money.fx()
  })
  // The first rates at start, so a new install converts without waiting.
  await boss.send(MONEY_QUEUES.fx, null).catch((err) => log.warn({ err }, 'could not queue rates'))
}
