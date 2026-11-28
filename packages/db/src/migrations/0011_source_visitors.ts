import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * How a source counts visitors. `daily` (the default) needs no cookie and
 * stores nothing in the browser: a person counts once per day and device.
 * `persistent` lets the browser script keep a random id in the site's storage,
 * so a person who comes back on another day counts once; the site owner turns
 * it on and takes care of consent where the law asks for it.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`
    alter table source
      add column visitor_mode text not null default 'daily'
        check (visitor_mode in ('daily', 'persistent'))`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`alter table source drop column visitor_mode`.execute(db)
}
