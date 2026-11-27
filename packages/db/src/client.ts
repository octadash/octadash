import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from './schema'

export interface CreateDbOptions {
  /** Maximum connections in the pool. Keep it small: Postgres connections are expensive. */
  max?: number
  /** Name shown in pg_stat_activity, useful to tell web, ingest and worker apart. */
  applicationName?: string
}

export function createDb(connectionString: string, options: CreateDbOptions = {}) {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'octadash',
  })
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
  return { db, pool }
}

export type Db = Kysely<Database>

/** Any Kysely instance, whatever its schema. Used by helpers that work on raw SQL. */
// biome-ignore lint/suspicious/noExplicitAny: helpers must accept every schema, as Kysely recommends
export type AnyDb = Kysely<any>
