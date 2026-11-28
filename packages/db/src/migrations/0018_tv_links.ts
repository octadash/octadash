import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Private TV links: a TV that is not signed in opens TV mode with one. Only a
 * hash of the token is kept; the link shows that screen and nothing else, and
 * stopping it blanks the TV. What the TV shows is saved with the link.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table tv_link (
      id uuid primary key,
      org_id uuid not null,
      token_hash text not null unique,
      settings jsonb not null,
      created_by uuid,
      created_at timestamptz not null default now(),
      last_opened_at timestamptz,
      stopped_at timestamptz
    )`.execute(db)
  await sql`create index tv_link_org on tv_link (org_id) where stopped_at is null`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table tv_link`.execute(db)
}
