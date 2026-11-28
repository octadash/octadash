import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * The outside watcher: an address at a service such as Healthchecks.io that
 * Octadash pings every minute, so someone is told when Octadash itself stops.
 * It belongs to the install, not to an organization. The URL is a secret
 * (anyone with it can fake the pings), so it is stored encrypted.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    alter table octadash_instance
      add column watcher_url text,
      add column watcher_status text not null default 'unknown'
        check (watcher_status in ('unknown', 'ok', 'failing')),
      add column watcher_checked_at timestamptz,
      add column watcher_error text`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`
    alter table octadash_instance
      drop column watcher_url,
      drop column watcher_status,
      drop column watcher_checked_at,
      drop column watcher_error`.execute(db)
}
