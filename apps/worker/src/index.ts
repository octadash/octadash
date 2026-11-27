import { createServer } from 'node:http'
import { createLogger, OCTADASH_VERSION, parseEnv, workerEnvSchema } from '@octadash/core'
import { createDb } from '@octadash/db'
import { PgBoss } from 'pg-boss'
import { startDiagnosisRunner } from './diagnosis'
import { registerJobs } from './jobs'

/**
 * The worker runs everything that is not a request: uptime checks, URL
 * diagnostics, alerts, connector syncs, rollups, partition upkeep and retention.
 * Jobs live in Postgres (pg-boss), so there is no Redis to install.
 */
const env = parseEnv(workerEnvSchema)
const log = createLogger('worker', env.LOG_LEVEL)

const boss = new PgBoss({ connectionString: env.DATABASE_URL, application_name: 'octadash-worker' })
boss.on('error', (err) => log.error({ err }, 'pg-boss error'))

const { db, pool } = createDb(env.DATABASE_URL, { max: 5, applicationName: 'octadash-worker' })

await boss.start()
await registerJobs(boss, db, log)
const diagnosis = startDiagnosisRunner(db, pool, log, {
  allowPrivate: env.OCTADASH_DIAGNOSIS_ALLOW_PRIVATE,
})
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
  await Promise.all([diagnosis.stop(), boss.stop({ graceful: true, timeout: 20_000 })])
  await pool.end()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
