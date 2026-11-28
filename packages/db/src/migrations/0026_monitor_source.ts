import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * A monitor may say which source of its product it checks ("Docs"): the
 * product page and Uptime show both together. Deleting the source keeps the
 * monitor and only drops the link.
 *
 * `same_server_dismissed_at`: someone closed the notice that this monitor
 * points to the server Octadash runs on. A new monitor there brings it back.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    alter table monitor
      add column source_id uuid references source (id) on delete set null,
      add column same_server_dismissed_at timestamptz`.execute(db)
  await sql`create index monitor_source_idx on monitor (source_id) where source_id is not null`.execute(
    db,
  )
}

export async function down(db: AnyDb): Promise<void> {
  await sql`alter table monitor drop column source_id, drop column same_server_dismissed_at`.execute(
    db,
  )
}
