import { sql } from 'kysely'
import type { AnyDb } from '../client'

/**
 * What each token may touch, resource by resource: `{ levels: { products:
 * "write", logs: "read", ... }, delete: ["products"] }` (see token-scopes.ts).
 * Tokens made before this were read-only, so they read every resource.
 */
export async function up(db: AnyDb): Promise<void> {
  await sql`alter table api_token add column scopes jsonb not null default '{"levels":{},"delete":[]}'`.execute(
    db,
  )
  const levels = Object.fromEntries(
    [
      'products',
      'sources',
      'keys',
      'monitors',
      'alerts',
      'traffic',
      'usage',
      'key_events',
      'errors',
      'logs',
      'money',
      'costs',
      'settings',
    ].map((r) => [r, 'read']),
  )
  await sql`update api_token set scopes = ${JSON.stringify({ levels, delete: [] })}::jsonb`.execute(
    db,
  )
}

export async function down(db: AnyDb): Promise<void> {
  await sql`alter table api_token drop column scopes`.execute(db)
}
