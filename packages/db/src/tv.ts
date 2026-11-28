import { createHash, randomBytes } from 'node:crypto'
import { uuidv7 } from '@octadash/core'
import type { Db } from './client'

/** What a TV link shows. The page reads the same shape from its address. */
export interface TvSettings {
  /** "all", "g:<group slug>" or "p:<product slug>". */
  scope: string
  /** Up to 3 numbers per product. */
  metrics: string[]
  perPage: number
  sound: boolean
}

function hash(token: string) {
  return createHash('sha256').update(`octadash:tv:${token}`).digest('hex')
}

/**
 * Makes the organization's private TV link, stopping the one before: one link
 * at a time, so "Stop this link" always blanks every TV that had it. Returns
 * the token, shown once in the link and never stored.
 */
export async function createTvLink(
  db: Db,
  orgId: string,
  userId: string | null,
  settings: TvSettings,
): Promise<string> {
  const token = randomBytes(24).toString('base64url')
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('tv_link')
      .set({ stopped_at: new Date() })
      .where('org_id', '=', orgId)
      .where('stopped_at', 'is', null)
      .execute()
    await trx
      .insertInto('tv_link')
      .values({
        id: uuidv7(),
        org_id: orgId,
        token_hash: hash(token),
        settings: JSON.stringify(settings),
        created_by: userId,
      })
      .execute()
  })
  return token
}

/** The working link of an organization, without its token. */
export function getTvLink(db: Db, orgId: string) {
  return db
    .selectFrom('tv_link')
    .leftJoin('auth_user', 'auth_user.id', 'tv_link.created_by')
    .select([
      'tv_link.id',
      'tv_link.settings',
      'tv_link.created_at',
      'tv_link.last_opened_at',
      'auth_user.name as created_by_name',
    ])
    .where('tv_link.org_id', '=', orgId)
    .where('tv_link.stopped_at', 'is', null)
    .executeTakeFirst()
}

/** "Stop this link": the TVs that had it go blank on their next update. */
export async function stopTvLink(db: Db, orgId: string) {
  const result = await db
    .updateTable('tv_link')
    .set({ stopped_at: new Date() })
    .where('org_id', '=', orgId)
    .where('stopped_at', 'is', null)
    .executeTakeFirst()
  return result.numUpdatedRows > 0n
}

/**
 * The organization and settings a TV token opens, or undefined for an
 * unknown or stopped link. Notes when it was last opened, at most once a minute.
 */
export async function openTvLink(db: Db, token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return undefined
  const link = await db
    .selectFrom('tv_link')
    .select(['id', 'org_id', 'settings', 'last_opened_at'])
    .where('token_hash', '=', hash(token))
    .where('stopped_at', 'is', null)
    .executeTakeFirst()
  if (!link) return undefined
  if (!link.last_opened_at || now.getTime() - link.last_opened_at.getTime() > 60_000) {
    await db.updateTable('tv_link').set({ last_opened_at: now }).where('id', '=', link.id).execute()
  }
  return { orgId: link.org_id, settings: link.settings as unknown as TvSettings }
}
