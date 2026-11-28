import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Sources: the parts of a product that send data ("Site, Next.js", "API,
 * .NET"). A source has a name, a platform and the areas it feeds; the area of
 * each piece of data comes from its kind (a page view is Traffic, an error is
 * Errors), so one browser script can feed Traffic and Product usage with one
 * key.
 *
 * Keys move to the source: `project_key` becomes `source_key`, so a source can
 * hold a new key and an old one while an app is redeployed. Rows from before
 * sources keep a null `source_id` and still work at the ingest; they are
 * dropped once the setup screens create sources.
 *
 * Data for an area the owner marked "I won't use this" is not stored; the
 * area counts it (`discarded_events`, `discarded_at`) so its card can say the
 * area is receiving data while off.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table source (
      id uuid primary key,
      org_id uuid not null,
      project_id uuid not null references project (id) on delete cascade,
      name text not null,
      platform text not null,
      areas text[] not null default '{}',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`.execute(db)
  await sql`create index source_project_idx on source (project_id)`.execute(db)

  await sql`alter table project_key rename to source_key`.execute(db)
  await sql`alter index project_key_project_idx rename to source_key_project_idx`.execute(db)
  await sql`
    alter table source_key
      add column source_id uuid references source (id) on delete cascade`.execute(db)
  await sql`create index source_key_source_idx on source_key (source_id)`.execute(db)

  await sql`
    alter table project_area
      add column discarded_events bigint not null default 0,
      add column discarded_at timestamptz`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`
    alter table project_area drop column discarded_events, drop column discarded_at`.execute(db)
  await sql`delete from source_key where source_id is not null`.execute(db)
  await sql`alter table source_key drop column source_id`.execute(db)
  await sql`alter index source_key_project_idx rename to project_key_project_idx`.execute(db)
  await sql`alter table source_key rename to project_key`.execute(db)
  await sql`drop table source`.execute(db)
}
