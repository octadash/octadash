import { createServer } from 'node:http'
import { createLogger, OCTADASH_VERSION, parseEnv, workerEnvSchema } from '@octadash/core'
import { createClickHouse, createDb } from '@octadash/db'
import { createValkey } from '@octadash/queue'
import { PgBoss } from 'pg-boss'
import { registerJobs } from './jobs'
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
const writers = startWriters(valkey, clickhouse, log)
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
  await Promise.all([writers.stop(), boss.stop({ graceful: true, timeout: 20_000 })])
  valkey.disconnect()
  await Promise.all([clickhouse.close(), pool.end()])
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
