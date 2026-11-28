import { createHash, randomBytes } from 'node:crypto'
import { uuidv7 } from '@octadash/core'
import type { Db } from './client'
import { cleanScopes, type TokenScopes } from './token-scopes'

const PREFIX = 'oct_'

function hash(token: string) {
  return createHash('sha256').update(`octadash:api:${token}`).digest('hex')
}

/** Whether a string looks like an Octadash token, before any database read. */
export function isApiToken(value: string): boolean {
  return /^oct_[A-Za-z0-9_-]{32}$/.test(value)
}

/** Makes a token and returns it: shown once, never stored. */
export async function createApiToken(
  db: Db,
  orgId: string,
  userId: string | null,
  name: string,
  scopes: TokenScopes,
): Promise<string> {
  const token = `${PREFIX}${randomBytes(24).toString('base64url')}`
  await db
    .insertInto('api_token')
    .values({
      id: uuidv7(),
      org_id: orgId,
      name: name.trim().slice(0, 80) || 'Token',
      token_hash: hash(token),
      prefix: token.slice(0, PREFIX.length + 4),
      created_by: userId,
      scopes: JSON.stringify(cleanScopes(scopes)),
    })
    .execute()
  return token
}

/** Every token of an organization, newest first, without the secret. */
export async function listApiTokens(db: Db, orgId: string) {
  const rows = await db
    .selectFrom('api_token')
    .leftJoin('auth_user', 'auth_user.id', 'api_token.created_by')
    .select([
      'api_token.id',
      'api_token.name',
      'api_token.prefix',
      'api_token.created_at',
      'api_token.last_used_at',
      'api_token.revoked_at',
      'api_token.scopes',
      'auth_user.name as created_by_name',
    ])
    .where('api_token.org_id', '=', orgId)
    .orderBy('api_token.created_at', 'desc')
    .execute()
  return rows.map((row) => ({ ...row, scopes: cleanScopes(row.scopes) }))
}

export async function revokeApiToken(db: Db, orgId: string, id: string): Promise<void> {
  await db
    .updateTable('api_token')
    .set({ revoked_at: new Date() })
    .where('org_id', '=', orgId)
    .where('id', '=', id)
    .where('revoked_at', 'is', null)
    .execute()
}

/**
 * The organization and scope of a working token, or null. Marks it used, at
 * most once a minute, so the list shows when it was last used.
 */
export async function findApiToken(
  db: Db,
  token: string,
): Promise<{ orgId: string; scopes: TokenScopes; tokenId: string } | null> {
  if (!isApiToken(token)) return null
  const row = await db
    .selectFrom('api_token')
    .select(['id', 'org_id', 'last_used_at', 'scopes'])
    .where('token_hash', '=', hash(token))
    .where('revoked_at', 'is', null)
    .executeTakeFirst()
  if (!row) return null
  if (!row.last_used_at || Date.now() - row.last_used_at.getTime() > 60_000) {
    await db
      .updateTable('api_token')
      .set({ last_used_at: new Date() })
      .where('id', '=', row.id)
      .execute()
  }
  return { orgId: row.org_id, scopes: cleanScopes(row.scopes), tokenId: row.id }
}
