import { slugify, uuidv7 } from '@octadash/core'
import { sql } from 'kysely'
import type { Db } from './client'
import type { VisitorMode } from './schema'

/**
 * Data access for products. Every function takes the organization id: there is
 * no way to read or change a product without naming its tenant.
 */

/** A product starts with its name only; platforms are chosen inside each area. */
export interface ProjectInput {
  name: string
}

export function listProjects(db: Db, orgId: string) {
  return db.selectFrom('project').selectAll().where('org_id', '=', orgId).orderBy('name').execute()
}

/**
 * A product by its address. An old address, from before a rename, finds the
 * product too; a product that holds the address now wins over an old one.
 */
export function getProjectBySlug(db: Db, orgId: string, slug: string) {
  return db
    .selectFrom('project')
    .selectAll()
    .where('org_id', '=', orgId)
    .where((eb) =>
      eb.or([
        eb('slug', '=', slug),
        eb(
          'id',
          'in',
          eb
            .selectFrom('project_slug_alias')
            .select('project_id')
            .where('org_id', '=', orgId)
            .where('slug', '=', slug),
        ),
      ]),
    )
    .orderBy(sql`slug = ${slug}`, 'desc')
    .limit(1)
    .executeTakeFirst()
}

async function uniqueSlug(db: Db, orgId: string, name: string, exceptId?: string) {
  const base = slugify(name)
  const taken = new Set(
    (
      await db
        .selectFrom('project')
        .select('slug')
        .where('org_id', '=', orgId)
        .where('slug', 'like', `${base}%`)
        .$if(Boolean(exceptId), (q) => q.where('id', '!=', exceptId as string))
        .execute()
    ).map((row) => row.slug),
  )
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Creates a product with its name only. Keys come with its sources, added in each area. */
export async function createProject(db: Db, orgId: string, input: ProjectInput) {
  return db
    .insertInto('project')
    .values({
      id: uuidv7(),
      org_id: orgId,
      name: input.name.trim(),
      slug: await uniqueSlug(db, orgId, input.name),
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

/**
 * Renames a product. Its address follows the name; the old address is kept as
 * an alias so links and bookmarks keep working.
 */
export async function updateProject(db: Db, orgId: string, projectId: string, input: ProjectInput) {
  return db.transaction().execute(async (trx) => {
    const before = await trx
      .selectFrom('project')
      .select('slug')
      .where('org_id', '=', orgId)
      .where('id', '=', projectId)
      .executeTakeFirst()
    if (!before) return undefined
    const project = await trx
      .updateTable('project')
      .set({
        name: input.name.trim(),
        slug: await uniqueSlug(trx, orgId, input.name, projectId),
        updated_at: new Date(),
      })
      .where('org_id', '=', orgId)
      .where('id', '=', projectId)
      .returningAll()
      .executeTakeFirstOrThrow()
    if (project.slug !== before.slug) {
      await trx
        .insertInto('project_slug_alias')
        .values({ org_id: orgId, slug: before.slug, project_id: projectId })
        .onConflict((oc) => oc.columns(['org_id', 'slug']).doUpdateSet({ project_id: projectId }))
        .execute()
      // The product's own address is never an alias of itself.
      await trx
        .deleteFrom('project_slug_alias')
        .where('org_id', '=', orgId)
        .where('project_id', '=', projectId)
        .where('slug', '=', project.slug)
        .execute()
    }
    return project
  })
}

export async function deleteProject(db: Db, orgId: string, projectId: string) {
  const result = await db
    .deleteFrom('project')
    .where('org_id', '=', orgId)
    .where('id', '=', projectId)
    .executeTakeFirst()
  return result.numDeletedRows > 0n
}

/**
 * The product and source an ingest key belongs to, or undefined when the key is
 * unknown or revoked. `source_id` is null for a product key from before sources.
 */
export function findIngestKey(db: Db, publicKey: string) {
  return (
    db
      .selectFrom('source_key')
      .leftJoin('source', 'source.id', 'source_key.source_id')
      .select([
        'source_key.org_id',
        'source_key.project_id',
        'source_key.source_id',
        // A product key from before sources counts by the day.
        sql<VisitorMode>`coalesce(source.visitor_mode, 'daily')`.as('visitor_mode'),
      ])
      .where('source_key.public_key', '=', publicKey)
      // A rotated key keeps working until its revocation time.
      .where((eb) =>
        eb.or([
          eb('source_key.revoked_at', 'is', null),
          eb('source_key.revoked_at', '>', sql<Date>`now()`),
        ]),
      )
      .executeTakeFirst()
  )
}

/** Builds a Sentry-compatible DSN for a product: https://<public_key>@<ingest host>/<ingest_id>. */
export function sentryDsn(ingestUrl: string, publicKey: string, ingestId: string): string {
  const url = new URL(ingestUrl)
  return `${url.protocol}//${publicKey}@${url.host}/${ingestId}`
}
