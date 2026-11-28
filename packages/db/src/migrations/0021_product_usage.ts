import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Product usage. The events live in ClickHouse (`events`); Postgres keeps what
 * people decide about them.
 *
 * `key_event`: the events a product cannot live without (a sign-up, a
 * payment). Each gets what is normal for its time of day, and the "Key event
 * stopped" rule opens an emergency when one stops arriving.
 *
 * `funnel`: steps in order (event names), counted per person within
 * `window_days` of the first step. A funnel belongs to one product.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table key_event (
      project_id uuid not null references project (id) on delete cascade,
      org_id uuid not null,
      event text not null,
      created_by uuid,
      created_at timestamptz not null default now(),
      primary key (project_id, event)
    )`.execute(db)
  await sql`create index key_event_org on key_event (org_id)`.execute(db)
  await sql`
    create table funnel (
      id uuid primary key,
      org_id uuid not null,
      project_id uuid not null references project (id) on delete cascade,
      name text not null,
      steps jsonb not null,
      window_days integer not null default 7,
      created_by uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`.execute(db)
  await sql`create index funnel_org on funnel (org_id, project_id)`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table funnel`.execute(db)
  await sql`drop table key_event`.execute(db)
}
