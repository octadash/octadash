import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * The Error spike rule asks every minute which products had errors lately,
 * across organizations; this index answers without reading every issue.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`create index error_issue_last_seen on error_issue (last_seen)`.execute(db)
}

export async function down(db: AnyDb): Promise<void> {
  await sql`drop index error_issue_last_seen`.execute(db)
}
