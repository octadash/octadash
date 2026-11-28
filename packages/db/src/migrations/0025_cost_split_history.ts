import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * How a shared connection was divided, from a day on. Every change to a
 * connection's split or to a product's part keeps a copy of the whole
 * division (`split` plus every product's `shares`) from that day in the
 * organization's time zone, so changing it today leaves past months as they
 * were. Several changes on one day keep the last one.
 *
 * Existing connections get their current division from the start, which is
 * what was shown until now.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    create table cost_split_history (
      connection_id uuid not null references connection (id) on delete cascade,
      org_id uuid not null,
      valid_from date not null,
      split text not null,
      shares jsonb not null,
      primary key (connection_id, valid_from)
    )`.execute(db)
  await sql`
    insert into cost_split_history (connection_id, org_id, valid_from, split, shares)
    select c.id, c.org_id, date '1970-01-01', c.split,
      coalesce(
        (select jsonb_agg(jsonb_build_object(
            'projectId', s.project_id, 'tags', to_jsonb(s.tags), 'rest', s.rest, 'percent', s.percent)
          order by s.created_at)
         from cost_share s where s.connection_id = c.id),
        '[]'::jsonb)
    from connection c
    where exists (select 1 from cost_share s where s.connection_id = c.id)`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop table cost_split_history`.execute(db)
}
