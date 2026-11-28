import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * What an organization is set to, asked once on the first screen: the main
 * currency (money in other currencies keeps its value and is shown converted)
 * and the time zone ("today", day buckets and the daily summary follow it).
 * An organization without a row uses the defaults in `organization.ts`.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table organization_settings (
      org_id uuid primary key,
      currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
      time_zone text not null default 'UTC',
      updated_at timestamptz not null default now()
    )`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table organization_settings`.execute(db)
}
