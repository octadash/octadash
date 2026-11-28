import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Monitors as closed in the Uptime canvas:
 * - `schedule`: a heartbeat may expect its call on a cron schedule ("every day
 *   at 3:00 AM"), read in the organization's time zone, instead of every N
 *   seconds.
 * - `timeout_seconds`: how long a site or /health check waits for an answer.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`alter table monitor add column schedule text`.execute(db)
  await sql`alter table monitor add column timeout_seconds integer not null default 10`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`alter table monitor drop column timeout_seconds`.execute(db)
  await sql`alter table monitor drop column schedule`.execute(db)
}
