import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Products (called projects in code, as in Sentry and PostHog) and their ingest
 * keys. `ingest_id` is a small number because Sentry SDKs require a numeric
 * project id in the DSN. `org_id` points to auth_organization without a foreign
 * key, so tenant data can be sharded by org_id later.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table project (
      id uuid primary key,
      org_id uuid not null,
      ingest_id bigint generated always as identity unique,
      name text not null,
      slug text not null,
      url text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (org_id, slug)
    )`.execute(db)

  await sql`
    create table project_key (
      id uuid primary key,
      org_id uuid not null,
      project_id uuid not null references project (id) on delete cascade,
      public_key text not null unique,
      label text not null default 'Default',
      created_at timestamptz not null default now(),
      revoked_at timestamptz
    )`.execute(db)
  await sql`create index project_key_project_idx on project_key (project_id)`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table project_key`.execute(db)
  await sql`drop table project`.execute(db)
}
