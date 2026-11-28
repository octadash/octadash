import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * The URL diagnosis is gone (docs/architecture.md, "URL diagnosis removed"), so
 * its table goes too. `project.url` stays for now: the uptime step turns each
 * stored address into the product's first "Site" monitor and then drops it.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`drop table if exists diagnosis`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`
    create table diagnosis (
      id uuid primary key,
      org_id uuid not null,
      project_id uuid not null references project (id) on delete cascade,
      url text not null,
      trigger text not null,
      status text not null default 'queued'
        check (status in ('queued', 'running', 'done', 'failed')),
      attempts integer not null default 0,
      report jsonb,
      error text,
      created_at timestamptz not null default now(),
      started_at timestamptz,
      finished_at timestamptz
    )`.execute(db)
}
