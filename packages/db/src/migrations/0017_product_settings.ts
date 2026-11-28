import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Product settings.
 *
 * - The product key from before sources becomes a source named "Main", so
 *   every key belongs to a source and the Sources page lists it with the
 *   others. Apps that use it keep working: the key does not change.
 * - A product's address changes when it is renamed; the old address is kept
 *   in `project_slug_alias` so links and bookmarks keep working.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    insert into source (id, org_id, project_id, name, platform, areas)
    select gen_random_uuid(), k.org_id, k.project_id, 'Main', 'other', '{}'
    from (select distinct org_id, project_id from source_key where source_id is null) k
  `.execute(db)
  await sql`
    update source_key k set source_id = s.id
    from source s
    where k.source_id is null and s.project_id = k.project_id and s.name = 'Main'
      and s.platform = 'other'
  `.execute(db)

  await sql`
    create table project_slug_alias (
      org_id uuid not null,
      slug text not null,
      project_id uuid not null references project (id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (org_id, slug)
    )`.execute(db)
  await sql`create index project_slug_alias_project on project_slug_alias (project_id)`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table project_slug_alias`.execute(db)
}
