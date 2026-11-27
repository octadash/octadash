import { type AnyDb, migrateToLatest } from '@octadash/db'
import { getMigrations } from 'better-auth/db/migration'
import type pg from 'pg'
import { buildAuthOptions } from './options'

/**
 * Applies Better Auth's schema (accounts, sessions, organizations), then
 * Octadash's own migrations. Auth first: Octadash tables refer to organizations.
 */
export async function migrateAll(db: AnyDb, pool: pg.Pool) {
  const options = buildAuthOptions({
    pool,
    // Not used to build the schema; Better Auth only needs a value.
    secret: process.env.OCTADASH_SECRET ?? 'migration-only-secret-not-used-for-signing',
    baseURL: process.env.OCTADASH_URL ?? 'http://localhost:3000',
  })
  const { runMigrations } = await getMigrations(options)
  await runMigrations()
  return migrateToLatest(db)
}
