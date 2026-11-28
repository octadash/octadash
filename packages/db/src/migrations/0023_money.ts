import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Money. Payments and subscriptions live in ClickHouse; Postgres keeps the
 * connections to the gateways, which products each one serves, and the day's
 * exchange rates.
 *
 * `connection`: one gateway account (Stripe, Asaas, Paddle), shared by the
 * organization. The key and webhook secret are encrypted with
 * OCTADASH_SECRET. `webhook_token` is the random part of the webhook URL.
 * Costs will add its connections (OpenAI, a VPS provider) to the same table.
 *
 * `connection_project`: a product served by a connection, and the rule that
 * picks its payments: the whole account, some gateway products, or a
 * `product` metadata value.
 *
 * `fx_rate`: units of a currency per US dollar on a day, every day filled.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table connection (
      id uuid primary key,
      org_id uuid not null,
      integration text not null,
      name text not null,
      secrets text not null,
      key_hint text not null default '',
      webhook_token text not null unique,
      status text not null default 'importing',
      last_error text,
      imported_at timestamptz,
      synced_at timestamptz,
      subscriptions_synced_at timestamptz,
      webhook_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`.execute(db)
  await sql`create index connection_org on connection (org_id)`.execute(db)
  await sql`
    create table connection_project (
      connection_id uuid not null references connection (id) on delete cascade,
      project_id uuid not null,
      org_id uuid not null,
      mode text not null default 'all',
      "values" text[] not null default '{}',
      created_at timestamptz not null default now(),
      primary key (connection_id, project_id)
    )`.execute(db)
  await sql`create index connection_project_project on connection_project (project_id)`.execute(db)
  await sql`
    create table fx_rate (
      day date not null,
      currency text not null,
      per_usd double precision not null,
      primary key (day, currency)
    )`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table fx_rate`.execute(db)
  await sql`drop table connection_project`.execute(db)
  await sql`drop table connection`.execute(db)
}
