import { createServer } from 'node:http'
import {
  createLogger,
  decryptSecret,
  OCTADASH_VERSION,
  parseEnv,
  workerEnvSchema,
} from '@octadash/core'
import {
  createClickHouse,
  createDb,
  getWatcher,
  insertUptimeChecks,
  listActiveMonitors,
  recordWatcherPing,
  setMonitorStatus,
} from '@octadash/db'
import { createValkey, ValkeyHeartbeats } from '@octadash/queue'
import { checkUrl } from '@octadash/uptime'
import { PgBoss } from 'pg-boss'
import { createAlerts, registerAlertJobs } from './alerts'
import { registerJobs } from './jobs'
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

await boss.start()
await registerJobs(boss, db, log)
const alerts = createAlerts({
  db,
  clickhouse,
  boss,
  secret: env.OCTADASH_SECRET,
  panelUrl: env.OCTADASH_URL,
  log,
})
await registerAlertJobs(boss, alerts, log)
const writers = startWriters(valkey, clickhouse, log)
const heartbeats = new ValkeyHeartbeats(valkey)
const uptime = startUptime(
  new UptimeScheduler({
    loadMonitors: () => listActiveMonitors(db),
    check: checkUrl,
    readPings: (ids) => heartbeats.read(ids),
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
    record: (status, error, at) => recordWatcherPing(db, status, error, at),
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
  await Promise.all([clickhouse.close(), pool.end()])
  process.exit(0)
}

/** True when any of the addresses answers at all. */
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
