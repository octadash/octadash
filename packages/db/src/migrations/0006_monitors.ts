import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Uptime monitors. `site` and `health` are checked from the worker; a
 * `heartbeat` is the other way round: a cron job or backup calls the ingest
 * with `heartbeat_token`, and silence longer than the interval plus the grace
 * is an outage. `status` and `status_since` change only when the state flips,
 * so a check every minute writes to ClickHouse, not here.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table monitor (
      id uuid primary key,
      org_id uuid not null,
      project_id uuid not null references project (id) on delete cascade,
      name text not null,
      kind text not null check (kind in ('site', 'health', 'heartbeat')),
      url text,
      interval_seconds integer not null default 60 check (interval_seconds between 30 and 86400),
      grace_seconds integer not null default 0 check (grace_seconds between 0 and 86400),
      heartbeat_token text unique,
      paused boolean not null default false,
      status text not null default 'unknown' check (status in ('unknown', 'up', 'down')),
      status_since timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check ((kind = 'heartbeat') = (url is null)),
      check ((kind = 'heartbeat') = (heartbeat_token is not null))
    )`.execute(db)
  await sql`create index monitor_project_idx on monitor (org_id, project_id)`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table monitor`.execute(db)
}
