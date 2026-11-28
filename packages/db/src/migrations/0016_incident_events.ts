import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * The record of an emergency that people write, beside what the incident row
 * already says (opened, told, resolved): who took it or took it over, team
 * notes, and who closed it by hand and why. One row per event, never edited,
 * so the emergency page reads as a log.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table incident_event (
      id uuid primary key,
      org_id uuid not null,
      incident_id uuid not null references incident (id) on delete cascade,
      user_id uuid,
      kind text not null check (kind in ('took', 'note', 'closed')),
      body text,
      at timestamptz not null default now()
    )
  `.execute(db)
  await sql`create index incident_event_incident on incident_event (incident_id, at)`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table incident_event`.execute(db)
}
