import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Logs. The lines live in ClickHouse (`logs`); Postgres keeps how long each
 * product keeps them and the saved searches.
 *
 * `project_area.retention_days`: days an area keeps its data in this product;
 * null is the area's default (14 for logs). Other areas can use it later.
 *
 * `log_search`: a search box saved with a name. With `alert` on, the "Log
 * alert" rule opens an emergency in each product with a matching line since
 * `alert_since`, and closes it after a quiet spell.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`alter table project_area add column retention_days integer`.execute(db)
  await sql`
    create table log_search (
      id uuid primary key,
      org_id uuid not null,
      name text not null,
      query text not null,
      alert boolean not null default false,
      alert_since timestamptz,
      created_by uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`.execute(db)
  await sql`create index log_search_org on log_search (org_id)`.execute(db)
  await sql`create index log_search_alert on log_search (alert) where alert`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table log_search`.execute(db)
  await sql`alter table project_area drop column retention_days`.execute(db)
}
