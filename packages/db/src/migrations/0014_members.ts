import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Members, as closed in the Settings canvas:
 * - `member_seen`: when each person last opened the organization ("Last seen").
 *   Per organization, so one install never tells an organization what a person
 *   does in another.
 * - `invitation_email`: whether the invitation email went out, and why not.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table member_seen (
      org_id uuid not null,
      user_id uuid not null,
      seen_at timestamptz not null,
      primary key (org_id, user_id)
    )
  `.execute(db)
  await sql`
    create table invitation_email (
      invitation_id uuid primary key,
      org_id uuid not null,
      channel_id uuid,
      sent_at timestamptz,
      error text
    )
  `.execute(db)
  await sql`create index invitation_email_org on invitation_email (org_id)`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table invitation_email`.execute(db)
  await sql`drop table member_seen`.execute(db)
}
