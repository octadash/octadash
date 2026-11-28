import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * What the owner decided about each area of a product. No row means "not set
 * up yet" (the card offers "Set up"); `dismissed` is "I won't use this" (the
 * card moves to "Also available for this product"); `set_up` means the setup
 * was done and data is awaited. Whether data arrives is read from the data,
 * not stored here.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table project_area (
      org_id uuid not null,
      project_id uuid not null references project (id) on delete cascade,
      area text not null,
      state text not null check (state in ('set_up', 'dismissed')),
      updated_at timestamptz not null default now(),
      primary key (project_id, area)
    )`.execute(db)
  await sql`create index project_area_org_idx on project_area (org_id)`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table project_area`.execute(db)
}
