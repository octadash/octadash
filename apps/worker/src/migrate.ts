import { migrateAll } from '@octadash/auth'
import { baseEnvSchema, clickhouseEnvSchema, createLogger, parseEnv } from '@octadash/core'
import { createDb, migrateClickHouse, withAdvisoryLock } from '@octadash/db'

/**
 * Applies migrations, then exits. The Docker entrypoint runs this before every
 * role starts:
 *   - Postgres: Better Auth's schema, then Octadash's (Kysely holds a lock).
 *   - ClickHouse: the database and its tables, under a Postgres advisory lock so
 *     web and worker starting together never apply the same migration twice.
 * `node migrate.js postgres` skips ClickHouse. The ingest uses it: it only
 * needs the keys in Postgres, and must start even while ClickHouse is down.
 */
const postgresOnly = process.argv[2] === 'postgres'
const env = parseEnv(baseEnvSchema)
const clickhouse = postgresOnly ? null : parseEnv(clickhouseEnvSchema)
const log = createLogger('migrate', env.LOG_LEVEL)
const { db, pool } = createDb(env.DATABASE_URL, { max: 2, applicationName: 'octadash-migrate' })

let failed = false
try {
  const { error, results } = await migrateAll(db, pool)
  for (const result of results ?? []) {
    log[result.status === 'Error' ? 'error' : 'info'](
      { store: 'postgres', migration: result.migrationName, status: result.status },
      'migration',
    )
  }
  if (error) throw error
  log.info({ store: 'postgres', applied: results?.length ?? 0 }, 'database is up to date')

  if (clickhouse) {
    const applied = await withAdvisoryLock(pool, 'octadash_clickhouse_migrate', () =>
      migrateClickHouse(clickhouse.CLICKHOUSE_URL),
    )
    for (const result of applied) {
      log.info({ store: 'clickhouse', migration: result.migrationName }, 'migration')
    }
    log.info({ store: 'clickhouse', applied: applied.length }, 'database is up to date')
  }
} catch (error) {
  failed = true
  log.error({ err: error }, 'migrations failed')
}
await db.destroy()
process.exit(failed ? 1 : 0)
