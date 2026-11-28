import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Error issues: the same error in the same place is one issue. The issue is a
 * record (status, who is on it, when it was resolved and in which release);
 * every occurrence goes to ClickHouse (`errors`) with the issue's id.
 *
 * `resolved_release`: set by "Resolve in next release" to the release current
 * at the time; events from that release do not reopen the issue, events from
 * any other do. A plain "Resolve" leaves it null, so any new event reopens it.
 * `ignore_until`: {count?, people?, until?}; the issue comes back as Regressed
 * when one is met. `times_seen` counts events since the issue began.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table error_issue (
      id uuid primary key,
      org_id uuid not null,
      project_id uuid not null references project (id) on delete cascade,
      fingerprint text not null,
      type text not null,
      value text not null,
      culprit text not null,
      platform text not null,
      level text not null,
      handled boolean not null,
      first_seen timestamptz not null,
      last_seen timestamptz not null,
      first_release text not null,
      last_release text not null,
      times_seen bigint not null default 0,
      status text not null default 'unresolved',
      status_at timestamptz,
      status_by uuid,
      resolved_release text,
      ignore_until jsonb,
      ignored_times_seen bigint,
      regressed_at timestamptz,
      acknowledged_by uuid,
      acknowledged_at timestamptz,
      unique (project_id, fingerprint)
    )`.execute(db)
  await sql`create index error_issue_org_last on error_issue (org_id, last_seen desc)`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table error_issue`.execute(db)
}
