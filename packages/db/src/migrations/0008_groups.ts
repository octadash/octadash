import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Groups of products ("Clients", "My SaaS"), per organization. A product can be
 * in several groups. A group opens the overview by area filtered to its
 * products, and a TV screen can show one group.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table product_group (
      id uuid primary key,
      org_id uuid not null,
      name text not null,
      slug text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (org_id, slug)
    )`.execute(db)
  await sql`
    create table product_group_member (
      group_id uuid not null references product_group (id) on delete cascade,
      project_id uuid not null references project (id) on delete cascade,
      primary key (group_id, project_id)
    )`.execute(db)
  await sql`create index product_group_member_project_idx on product_group_member (project_id)`.execute(
    db,
  )
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table product_group_member`.execute(db)
  await sql`drop table product_group`.execute(db)
}
