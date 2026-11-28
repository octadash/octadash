import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * The "Get started" list on the first screens disappears when every step is
 * done, or for good when someone hides it.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`alter table organization_settings add column get_started_hidden_at timestamptz`.execute(
    db,
  )
}

export async function down(db: AnyDb): Promise<void> {
  await sql`alter table organization_settings drop column get_started_hidden_at`.execute(db)
}
