import { lookup } from 'node:dns/promises'
import { createServer } from 'node:http'
import {
  createLogger,
  decryptSecret,
  OCTADASH_VERSION,
  parseEnv,
  workerEnvSchema,
} from '@octadash/core'
import {
  addSourceAreas,
  areaRetention,
  createClickHouse,
  createDb,
  fileUsage,
  getWatcher,
  hitKey,
  insertErrors,
  insertLogs,
  insertReceived,
  insertUptimeChecks,
  issuePeople,
  listActiveMonitors,
  listDismissedAreas,
  logRetention,
  recordDiscarded,
  recordIssueHits,
  recordWatcherPing,
  setMonitorStatus,
} from '@octadash/db'
import {
  createValkey,
  ValkeyHeartbeats,
  ValkeyLivePublisher,
  ValkeyStorageStatus,
} from '@octadash/queue'
import { storageFromEnv } from '@octadash/storage'
import { checkUrl, diagnose } from '@octadash/uptime'
import { PgBoss } from 'pg-boss'
import { createAlerts, registerAlertJobs } from './alerts'
import { createCosts, registerCostJobs } from './costs'
import { registerFileJobs } from './files'
import { registerJobs } from './jobs'
import { createMoney, registerMoneyJobs } from './money'
import { EventRouter } from './routing'
import { startUptime, UptimeScheduler } from './uptime'
import { pingUrl, startWatcher, Watcher } from './watcher'
import { startWriters } from './writers'

/**
 * The worker runs everything that is not a request: it writes what the ingest
 * queued in Valkey to ClickHouse, and runs uptime checks, alerts, connector
 * syncs and rollups. Scheduled jobs live in Postgres (pg-boss).
 */
const env = parseEnv(workerEnvSchema)
const log = createLogger('worker', env.LOG_LEVEL)

const boss = new PgBoss({ connectionString: env.DATABASE_URL, application_name: 'octadash-worker' })
boss.on('error', (err) => log.error({ err }, 'pg-boss error'))

const { db, pool } = createDb(env.DATABASE_URL, { max: 5, applicationName: 'octadash-worker' })

const clickhouse = createClickHouse(env.CLICKHOUSE_URL, { applicationName: 'octadash-worker' })
const valkey = createValkey(env.VALKEY_URL, { name: 'octadash-worker' })
valkey.on('error', (err) => log.warn({ err: err.message }, 'valkey connection error'))
// The stream readers block on their connection (XREADGROUP BLOCK); sharing it
// would hold heartbeat reads and live updates behind every wait.
const streams = createValkey(env.VALKEY_URL, { name: 'octadash-worker-streams' })
streams.on('error', (err) => log.warn({ err: err.message }, 'valkey connection error'))
const live = new ValkeyLivePublisher(valkey)

await boss.start()
await registerJobs(boss, db, log)
const alerts = createAlerts({
  db,
  clickhouse,
  boss,
  secret: env.OCTADASH_SECRET,
  panelUrl: env.OCTADASH_URL,
  live,
  log,
  diagnose: async ({ monitor, reason, ip, status }) => {
    const found = await diagnose(
      monitor.url ?? '',
      { ip: ip ?? null, status: status ?? null, error: reason },
      { controls: env.OCTADASH_UPTIME_REFERENCE_URLS, ownAddresses },
    )
    return { ...found, at: new Date().toISOString() }
  },
})
await registerAlertJobs(boss, alerts, log)
await registerMoneyJobs(
  boss,
  createMoney({ db, clickhouse, secret: env.OCTADASH_SECRET, log }),
  log,
)
await registerCostJobs(boss, createCosts({ db, secret: env.OCTADASH_SECRET, log }))
const storageStatus = new ValkeyStorageStatus(valkey)
await registerFileJobs(
  boss,
  {
    store: storageFromEnv(env),
    host: env.STORAGE_ENDPOINT ? new URL(env.STORAGE_ENDPOINT).host : null,
    retentionDays: env.OCTADASH_RECEIVED_RETENTION_DAYS,
    limitBytes: Math.round(env.OCTADASH_STORAGE_LIMIT_GB * 1e9),
    usage: (days) => fileUsage(clickhouse, days),
    insertDropped: (rows) => insertReceived(clickhouse, rows),
    previous: () => storageStatus.read(),
    now: Date.now,
    log,
  },
  (status) => storageStatus.write(status),
)
const router = new EventRouter({
  loadDismissed: (projectIds) => listDismissedAreas(db, projectIds),
  recordDiscarded: (discarded, at) => recordDiscarded(db, discarded, at),
  addSourceAreas: (pairs) => addSourceAreas(db, pairs),
  now: Date.now,
})
const writers = startWriters(
  streams,
  clickhouse,
  router,
  {
    recordHits: async (hits) => {
      const outcomes = await recordIssueHits(db, hits, new Date(), (issueId, since) =>
        issuePeople(clickhouse, issueId, since),
      )
      const fresh = hits.flatMap((hit) => {
        const result = outcomes.get(hitKey(hit.project_id, hit.fingerprint))
        return result?.outcome === 'new'
          ? [
              {
                orgId: hit.org_id,
                projectId: hit.project_id,
                issueId: result.id,
                type: hit.type,
                value: hit.value,
                culprit: hit.culprit,
              },
            ]
          : []
      })
      // A message that fails to plan must never lose the batch of errors.
      if (fresh.length > 0)
        await alerts.onNewIssues(fresh).catch((err: unknown) => {
          log.warn({ err: err instanceof Error ? err.message : err }, 'new issue notice lost')
        })
      return outcomes
    },
    insert: (rows, token) => insertErrors(clickhouse, rows, token),
    loadRetention: (projectIds) => areaRetention(db, 'errors', projectIds),
    onChange: async (changes) => {
      for (const orgId of new Set(changes.map((change) => change.orgId))) {
        await live.publish(orgId, 'errors').catch(() => {})
      }
    },
  },
  {
    loadRetention: (projectIds) => logRetention(db, projectIds),
    insert: (rows, token) => insertLogs(clickhouse, rows, token),
  },
  log,
  {
    receivedDays: env.OCTADASH_RECEIVED_RETENTION_DAYS,
    traceDays: env.OCTADASH_TRACE_RETENTION_DAYS,
    metricDays: env.OCTADASH_METRIC_RETENTION_DAYS,
  },
)
const heartbeats = new ValkeyHeartbeats(valkey)
const uptime = startUptime(
  new UptimeScheduler({
    loadMonitors: () => listActiveMonitors(db),
    check: checkUrl,
    readPings: (ids) => heartbeats.read(ids),
    readFailures: (ids) => heartbeats.readFailures(ids),
    readOutputs: (ids, failed) => heartbeats.readOutputs(ids, failed),
    writeRows: (rows) => insertUptimeChecks(clickhouse, rows),
    setStatus: (id, from, to, at) => setMonitorStatus(db, id, from, to, at),
    onTransition: (transition) => alerts.onTransition(transition),
    isOnline: () => reachesAny(env.OCTADASH_UPTIME_REFERENCE_URLS),
    now: Date.now,
    log,
    allowPrivate: env.OCTADASH_UPTIME_ALLOW_PRIVATE,
  }),
  log,
)
const watcher = startWatcher(
  new Watcher({
    loadUrl: async () => {
      const row = await getWatcher(db)
      return row?.watcher_url ? decryptSecret(row.watcher_url, env.OCTADASH_SECRET) : null
    },
    ping: pingUrl,
    record: async (status, error, at) => {
      await recordWatcherPing(db, status, error, at)
      await live.publish(null, 'watcher').catch(() => {})
    },
    now: Date.now,
    log,
  }),
  log,
)
log.info('worker started')

// Health endpoint for Docker/Coolify. It reports the process state and never queries the database.
let healthy = true
const health = createServer((req, res) => {
  const ok = req.url === '/health' && healthy
  res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
  res.end(
    JSON.stringify({
      status: ok ? 'ok' : 'unavailable',
      service: 'worker',
      version: OCTADASH_VERSION,
    }),
  )
})
health.listen(env.WORKER_HEALTH_PORT, '0.0.0.0')

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down')
  healthy = false
  health.close()
  watcher.stop()
  await Promise.all([writers.stop(), uptime.stop(), boss.stop({ graceful: true, timeout: 20_000 })])
  valkey.disconnect()
  streams.disconnect()
  await Promise.all([clickhouse.close(), pool.end()])
  process.exit(0)
}

/** True when any of the addresses answers at all. */
let own: { addresses: Set<string>; at: number } | null = null

/** What the panel's address resolves to: the server Octadash runs on. Cached for an hour. */
async function ownAddresses(): Promise<Set<string>> {
  if (own && Date.now() - own.at < 3_600_000) return own.addresses
  const host = new URL(env.OCTADASH_URL).hostname
  const found = await lookup(host, { all: true }).catch(() => [])
  const addresses = new Set(
    found.map((entry) => entry.address).filter((a) => a !== '127.0.0.1' && a !== '::1'),
  )
  own = { addresses, at: Date.now() }
  return addresses
}

async function reachesAny(urls: string[]): Promise<boolean> {
  if (urls.length === 0) return true
  const attempts = urls.map(async (url) => {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5_000) })
    await res.body?.cancel()
    return true
  })
  return Promise.any(attempts).catch(() => false)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
