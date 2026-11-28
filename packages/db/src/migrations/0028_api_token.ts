import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Read-only tokens of an organization, for the MCP server (an AI assistant
 * asking about products) and later the public API. Only a hash is kept; the
 * token is shown once. Revoked tokens stay listed, so it is clear who had one.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table api_token (
      id uuid primary key,
      org_id uuid not null,
      name text not null,
      token_hash text not null unique,
      prefix text not null,
      created_by uuid,
      created_at timestamptz not null default now(),
      last_used_at timestamptz,
      revoked_at timestamptz
    )`.execute(db)
  await sql`create index api_token_org on api_token (org_id)`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table api_token`.execute(db)
}
