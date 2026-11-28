import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Costs. A provider account (OpenAI, Anthropic) or a fixed bill is a
 * `connection`, like a payment gateway; `split` says how the part no product
 * claims by tag is divided: equal, traffic or percent.
 *
 * `cost_share`: a product taking part of a connection's cost, by the
 * provider's tags (projects, workspaces) and/or a share of the rest.
 *
 * `fixed_cost`: the bill of a fixed connection (a VPS, a domain), counted
 * day by day.
 *
 * `cost_day`: what a provider charged per day, tag and line item, as read.
 * Read again, a day is replaced, so late corrections land.
 *
 * `cost_hour`: spend per hour and tag, for the "Cost runaway" emergency:
 * the provider's hours when it has them, or the growth of today's total
 * between hourly reads.
 *
 * `cost_budget`: a product's monthly budget in the organization's currency.
 * Costs are small (a few hundred rows a day per account), so they stay in
 * Postgres.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`alter table connection add column split text not null default 'equal'`.execute(db)
  await sql`
    create table cost_share (
      connection_id uuid not null references connection (id) on delete cascade,
      project_id uuid not null,
      org_id uuid not null,
      tags text[] not null default '{}',
      rest boolean not null default true,
      percent real,
      created_at timestamptz not null default now(),
      primary key (connection_id, project_id)
    )`.execute(db)
  await sql`create index cost_share_project on cost_share (project_id)`.execute(db)
  await sql`
    create table fixed_cost (
      connection_id uuid primary key references connection (id) on delete cascade,
      org_id uuid not null,
      amount bigint not null,
      currency text not null,
      every text not null default 'month',
      starts_on date not null
    )`.execute(db)
  await sql`
    create table cost_day (
      connection_id uuid not null references connection (id) on delete cascade,
      org_id uuid not null,
      day date not null,
      tag text not null default '',
      line_item text not null default '',
      amount double precision not null,
      currency text not null,
      updated_at timestamptz not null default now(),
      primary key (connection_id, day, tag, line_item)
    )`.execute(db)
  await sql`create index cost_day_org_day on cost_day (org_id, day)`.execute(db)
  await sql`
    create table cost_hour (
      connection_id uuid not null references connection (id) on delete cascade,
      org_id uuid not null,
      hour timestamptz not null,
      tag text not null default '',
      amount double precision not null,
      currency text not null,
      primary key (connection_id, hour, tag)
    )`.execute(db)
  await sql`create index cost_hour_org_hour on cost_hour (org_id, hour)`.execute(db)
  await sql`
    create table cost_budget (
      project_id uuid primary key,
      org_id uuid not null,
      amount bigint not null,
      warn integer not null default 80,
      updated_at timestamptz not null default now()
    )`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table cost_budget`.execute(db)
  await sql`drop table cost_hour`.execute(db)
  await sql`drop table cost_day`.execute(db)
  await sql`drop table fixed_cost`.execute(db)
  await sql`drop table cost_share`.execute(db)
  await sql`alter table connection drop column split`.execute(db)
}
