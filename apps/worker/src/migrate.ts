import { baseEnvSchema, createLogger, parseEnv } from '@octadash/core'
import { createDb, migrateToLatest } from '@octadash/db'

/**
 * Applies database migrations, then exits. The Docker entrypoint runs this before
 * every service starts; concurrent runs are safe because Kysely takes a lock.
 */
const env = parseEnv(baseEnvSchema)
const log = createLogger('migrate', env.LOG_LEVEL)
const { db } = createDb(env.DATABASE_URL, { max: 1, applicationName: 'octadash-migrate' })

const { error, results } = await migrateToLatest(db)
for (const result of results ?? []) {
  log[result.status === 'Error' ? 'error' : 'info'](
    { migration: result.migrationName, status: result.status },
    'migration',
  )
}
await db.destroy()

if (error) {
  log.error({ err: error }, 'migrations failed')
  process.exit(1)
}
log.info({ applied: results?.length ?? 0 }, 'database is up to date')
