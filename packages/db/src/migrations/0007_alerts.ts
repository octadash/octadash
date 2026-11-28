import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * Alerts. Built so the panel and the messages never need to know every kind of
 * emergency in advance: an incident is a product, a kind, data to describe it,
 * when it started and ended. Kinds arrive with their areas.
 *
 * - channel: where alerts go (an integration plus its settings). Secrets are
 *   encrypted with OCTADASH_SECRET in `secrets`; `config` holds the rest.
 * - alert_rule: the level and settings of each kind. Rows without a product
 *   are the organization's defaults (seeded); a row with a product overrides
 *   them for that product.
 * - incident: one emergency. One open incident per `dedupe_key`, so the same
 *   outage is never opened twice. `parent_id` groups what a bigger incident
 *   explains (errors and an empty checkout while the site is down).
 * - notification: every message sent or failed, to show who was told.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table channel (
      id uuid primary key,
      org_id uuid not null,
      integration text not null,
      name text not null,
      locale text not null default 'en',
      config jsonb not null default '{}',
      secrets jsonb not null default '{}',
      enabled boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`.execute(db)
  await sql`create index channel_org_idx on channel (org_id)`.execute(db)

  await sql`
    create table alert_rule (
      id uuid primary key,
      org_id uuid not null,
      project_id uuid references project (id) on delete cascade,
      kind text not null,
      level text not null check (level in ('emergency', 'signal', 'off')),
      params jsonb not null default '{}',
      channel_ids uuid[],
      updated_at timestamptz not null default now()
    )`.execute(db)
  await sql`
    create unique index alert_rule_scope_idx
    on alert_rule (org_id, project_id, kind) nulls not distinct`.execute(db)

  await sql`
    create table incident (
      id uuid primary key,
      org_id uuid not null,
      project_id uuid not null references project (id) on delete cascade,
      monitor_id uuid references monitor (id) on delete cascade,
      parent_id uuid references incident (id) on delete set null,
      kind text not null,
      level text not null check (level in ('emergency', 'signal')),
      dedupe_key text not null,
      data jsonb not null default '{}',
      channel_ids uuid[],
      started_at timestamptz not null,
      notify_after timestamptz not null,
      resolved_at timestamptz,
      acknowledged_at timestamptz,
      -- Who took it ("Assumir"), shown to everyone. A user id; kept when the user leaves.
      acknowledged_by text,
      notified_open_at timestamptz,
      notified_resolve_at timestamptz
    )`.execute(db)
  await sql`
    create unique index incident_open_idx on incident (dedupe_key) where resolved_at is null`.execute(
    db,
  )
  await sql`create index incident_org_idx on incident (org_id, started_at desc)`.execute(db)
  await sql`
    create index incident_pending_idx on incident (notify_after)
    where notified_open_at is null or (resolved_at is not null and notified_resolve_at is null)`.execute(
    db,
  )

  await sql`
    create table notification (
      id uuid primary key,
      org_id uuid not null,
      channel_id uuid references channel (id) on delete set null,
      incident_ids uuid[] not null,
      event text not null check (event in ('open', 'resolve')),
      ok boolean not null,
      error text,
      sent_at timestamptz not null default now()
    )`.execute(db)
  await sql`create index notification_org_idx on notification (org_id, sent_at desc)`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table notification`.execute(db)
  await sql`drop table incident`.execute(db)
  await sql`drop table alert_rule`.execute(db)
  await sql`drop table channel`.execute(db)
}
