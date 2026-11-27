import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Diagnoses of a product's site. The table is also the work queue: the panel
 * inserts a queued row and notifies `octadash_diagnosis`, and the worker claims
 * rows with SKIP LOCKED. The finished report is kept as JSON.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table diagnosis (
      id uuid primary key,
      org_id uuid not null,
      project_id uuid not null references project (id) on delete cascade,
      url text not null,
      trigger text not null,
      status text not null default 'queued'
        check (status in ('queued', 'running', 'done', 'failed')),
      attempts integer not null default 0,
      report jsonb,
      error text,
      created_at timestamptz not null default now(),
      started_at timestamptz,
      finished_at timestamptz
    )`.execute(db)
  await sql`create index diagnosis_project_idx on diagnosis (project_id, created_at desc)`.execute(
    db,
  )
  await sql`create index diagnosis_org_idx on diagnosis (org_id, created_at desc)`.execute(db)
  await sql`
    create index diagnosis_pending_idx on diagnosis (created_at)
    where status in ('queued', 'running')`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table diagnosis`.execute(db)
}
