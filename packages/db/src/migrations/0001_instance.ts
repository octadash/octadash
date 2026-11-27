import { sql } from 'kysely'
import type { AnyDb } from '../client'

/** Identifies this install. Used later for the setup wizard and anonymous version checks. */
export async function up(db: AnyDb): Promise<void> {
  await db.schema
    .createTable('octadash_instance')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()
  await sql`insert into octadash_instance default values`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await db.schema.dropTable('octadash_instance').execute()
}
