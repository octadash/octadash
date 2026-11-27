import { migrateAll } from '@octadash/auth'
import { baseEnvSchema, createLogger, parseEnv } from '@octadash/core'
import { createDb } from '@octadash/db'

/**
 * Applies database migrations (Better Auth's schema, then Octadash's), then
 * exits. The Docker entrypoint runs this before every service starts; Octadash's
 * own migrations take a lock, and Better Auth's only create what is missing.
 */
const env = parseEnv(baseEnvSchema)
const log = createLogger('migrate', env.LOG_LEVEL)
const { db, pool } = createDb(env.DATABASE_URL, { max: 1, applicationName: 'octadash-migrate' })

let failed = false
try {
  const { error, results } = await migrateAll(db, pool)
  for (const result of results ?? []) {
    log[result.status === 'Error' ? 'error' : 'info'](
      { migration: result.migrationName, status: result.status },
      'migration',
    )
  }
  if (error) throw error
  log.info({ applied: results?.length ?? 0 }, 'database is up to date')
} catch (error) {
  failed = true
  log.error({ err: error }, 'migrations failed')
}
await db.destroy()
process.exit(failed ? 1 : 0)
