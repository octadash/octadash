import { type MigrationResultSet, Migrator } from 'kysely/migration'
import type { AnyDb } from './client'
import { migrations } from './migrations'

/**
 * Applies pending migrations. Safe to call from several processes at once:
 * Kysely holds a lock table while it migrates, so only one process applies them.
 */
export async function migrateToLatest(db: AnyDb): Promise<MigrationResultSet> {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
    migrationTableName: 'octadash_migration',
    migrationLockTableName: 'octadash_migration_lock',
  })
  return migrator.migrateToLatest()
}
