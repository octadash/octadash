import { generatePublicKey, uuidv7 } from '@octadash/core'
import { sql } from 'kysely'
import type { Db } from './client'
import type { VisitorMode } from './schema'

/**
 * Sources of a product: each has a name, a platform, the areas it feeds and
 * its own key. Every function names the organization, so no call reaches
 * another tenant's sources.
 */

export interface SourceInput {
  name: string
  platform: string
  areas: string[]
}

export interface Source {
  id: string
  project_id: string
  name: string
  platform: string
  areas: string[]
  /** How Traffic counts this source's visitors; the install snippet follows it. */
  visitor_mode: VisitorMode
  /** The key the install snippet uses: the newest one not revoked. */
  public_key: string | null
  created_at: Date
}

function clean(input: SourceInput) {
  return {
    name: input.name.trim(),
    platform: input.platform.trim(),
    areas: [...new Set(input.areas)].sort(),
  }
}

/** Sources of one product, oldest first, each with its current key. */
export function listSources(db: Db, orgId: string, projectId: string): Promise<Source[]> {
  return db
    .selectFrom('source')
    .select([
      'source.id',
      'source.project_id',
      'source.name',
      'source.platform',
      'source.areas',
      'source.visitor_mode',
      'source.created_at',
      (eb) =>
        eb
          .selectFrom('source_key')
          .select('source_key.public_key')
          .whereRef('source_key.source_id', '=', 'source.id')
          .where('source_key.revoked_at', 'is', null)
          .orderBy('source_key.created_at', 'desc')
          .limit(1)
          .as('public_key'),
    ])
    .where('source.org_id', '=', orgId)
    .where('source.project_id', '=', projectId)
    .orderBy('source.created_at')
    .execute()
}

/** Creates a source with its key. Undefined when the product is not this organization's. */
export async function createSource(
  db: Db,
  orgId: string,
  projectId: string,
  input: SourceInput,
): Promise<Source | undefined> {
  return db.transaction().execute(async (trx) => {
    const project = await trx
      .selectFrom('project')
      .select('id')
      .where('org_id', '=', orgId)
      .where('id', '=', projectId)
      .executeTakeFirst()
    if (!project) return undefined
    const source = await trx
      .insertInto('source')
      .values({ id: uuidv7(), org_id: orgId, project_id: projectId, ...clean(input) })
      .returning(['id', 'project_id', 'name', 'platform', 'areas', 'visitor_mode', 'created_at'])
      .executeTakeFirstOrThrow()
    const key = await trx
      .insertInto('source_key')
      .values({
        id: uuidv7(),
        org_id: orgId,
        project_id: projectId,
        source_id: source.id,
        public_key: generatePublicKey(),
        revoked_at: null,
      })
      .returning('public_key')
      .executeTakeFirstOrThrow()
    return { ...source, public_key: key.public_key }
  })
}

export async function updateSource(db: Db, orgId: string, sourceId: string, input: SourceInput) {
  const result = await db
    .updateTable('source')
    .set({ ...clean(input), updated_at: new Date() })
    .where('org_id', '=', orgId)
    .where('id', '=', sourceId)
    .executeTakeFirst()
  return result.numUpdatedRows > 0n
}

/**
 * Changes how Traffic counts a source's visitors. The ingest follows within a
 * minute (its key cache); the site's snippet needs `data-visitor="persistent"`
 * for the browser to keep an id.
 */
export async function setSourceVisitorMode(
  db: Db,
  orgId: string,
  sourceId: string,
  mode: VisitorMode,
) {
  const result = await db
    .updateTable('source')
    .set({ visitor_mode: mode, updated_at: new Date() })
    .where('org_id', '=', orgId)
    .where('id', '=', sourceId)
    .executeTakeFirst()
  return result.numUpdatedRows > 0n
}

/** The source's areas plus one, sorted and without repeats. */
export function withArea(area: string) {
  return sql<
    string[]
  >`(select array_agg(distinct a order by a) from unnest(array_append(areas, ${area}::text)) a)`
}

/** Adds an area to a source, as when an area's setup reuses an existing source. */
export async function addSourceArea(db: Db, orgId: string, sourceId: string, area: string) {
  const result = await db
    .updateTable('source')
    .set({
      areas: withArea(area),
      updated_at: new Date(),
    })
    .where('org_id', '=', orgId)
    .where('id', '=', sourceId)
    .executeTakeFirst()
  return result.numUpdatedRows > 0n
}

/** Deletes a source and its keys: its apps stop being accepted at once. */
export async function deleteSource(db: Db, orgId: string, sourceId: string) {
  const result = await db
    .deleteFrom('source')
    .where('org_id', '=', orgId)
    .where('id', '=', sourceId)
    .executeTakeFirst()
  return result.numDeletedRows > 0n
}

/**
 * Gives a source a new key. The old keys keep working until `revokeOldAt`
 * (null revokes them now), so an app can be redeployed with the new key first.
 * Returns the new key, or undefined when the source is not this organization's.
 */
export async function rotateSourceKey(
  db: Db,
  orgId: string,
  sourceId: string,
  revokeOldAt: Date | null = null,
): Promise<string | undefined> {
  return db.transaction().execute(async (trx) => {
    const source = await trx
      .selectFrom('source')
      .select(['id', 'project_id'])
      .where('org_id', '=', orgId)
      .where('id', '=', sourceId)
      .executeTakeFirst()
    if (!source) return undefined
    await trx
      .updateTable('source_key')
      .set({ revoked_at: revokeOldAt ?? new Date() })
      .where('source_id', '=', source.id)
      .where('revoked_at', 'is', null)
      .execute()
    const key = await trx
      .insertInto('source_key')
      .values({
        id: uuidv7(),
        org_id: orgId,
        project_id: source.project_id,
        source_id: source.id,
        public_key: generatePublicKey(),
        revoked_at: null,
      })
      .returning('public_key')
      .executeTakeFirstOrThrow()
    return key.public_key
  })
}

/** Every source of the organization, for pages that name the source of a row. */
export function listOrgSources(db: Db, orgId: string) {
  return db
    .selectFrom('source')
    .select(['id', 'project_id', 'name', 'platform', 'areas'])
    .where('org_id', '=', orgId)
    .orderBy('created_at')
    .execute()
}

/** Every source of the organization that feeds Traffic, for the Traffic page of any scope. */
export function listTrafficSources(db: Db, orgId: string) {
  return db
    .selectFrom('source')
    .select(['id', 'project_id', 'name', 'platform', 'visitor_mode'])
    .where('org_id', '=', orgId)
    .where(sql<boolean>`'traffic' = any(areas)`)
    .orderBy('created_at')
    .execute()
}

/** One source of the organization, with its current key; undefined when it is not theirs. */
export async function getSource(db: Db, orgId: string, sourceId: string) {
  const source = await db
    .selectFrom('source')
    .select(['id', 'project_id'])
    .where('org_id', '=', orgId)
    .where('id', '=', sourceId)
    .executeTakeFirst()
  if (!source) return undefined
  return (await listSources(db, orgId, source.project_id)).find((s) => s.id === sourceId)
}

/** Name and platform only: the areas come from what the source sends. */
export async function renameSource(
  db: Db,
  orgId: string,
  sourceId: string,
  input: { name: string; platform: string },
) {
  const result = await db
    .updateTable('source')
    .set({ name: input.name.trim(), platform: input.platform.trim(), updated_at: new Date() })
    .where('org_id', '=', orgId)
    .where('id', '=', sourceId)
    .executeTakeFirst()
  return result.numUpdatedRows > 0n
}

/**
 * The keys of a source that still work, newest first: the current one
 * (`revoked_at` null) and old ones still inside their overlap after a rotation.
 */
export function listSourceKeys(db: Db, orgId: string, sourceId: string, now = new Date()) {
  return db
    .selectFrom('source_key')
    .select(['id', 'public_key', 'created_at', 'revoked_at'])
    .where('org_id', '=', orgId)
    .where('source_id', '=', sourceId)
    .where((eb) => eb.or([eb('revoked_at', 'is', null), eb('revoked_at', '>', now)]))
    .orderBy('created_at', 'desc')
    .execute()
}

/** "Stop now" on an old key still inside its overlap. The current key cannot be stopped this way. */
export async function stopOldKey(db: Db, orgId: string, keyId: string, now = new Date()) {
  const result = await db
    .updateTable('source_key')
    .set({ revoked_at: now })
    .where('org_id', '=', orgId)
    .where('id', '=', keyId)
    .where('revoked_at', '>', now)
    .executeTakeFirst()
  return result.numUpdatedRows > 0n
}
