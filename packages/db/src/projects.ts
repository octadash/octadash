import { generatePublicKey, slugify, uuidv7 } from '@octadash/core'
import type { Db } from './client'

/**
 * Data access for products. Every function takes the organization id: there is
 * no way to read or change a product without naming its tenant.
 */

export interface ProjectInput {
  name: string
  url: string | null
}

export function listProjects(db: Db, orgId: string) {
  return db.selectFrom('project').selectAll().where('org_id', '=', orgId).orderBy('name').execute()
}

export function getProjectBySlug(db: Db, orgId: string, slug: string) {
  return db
    .selectFrom('project')
    .selectAll()
    .where('org_id', '=', orgId)
    .where('slug', '=', slug)
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

/** Creates a product with its first ingest key. */
export async function createProject(db: Db, orgId: string, input: ProjectInput) {
  return db.transaction().execute(async (trx) => {
    const project = await trx
      .insertInto('project')
      .values({
        id: uuidv7(),
        org_id: orgId,
        name: input.name.trim(),
        slug: await uniqueSlug(trx, orgId, input.name),
        url: input.url,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    await trx
      .insertInto('project_key')
      .values({
        id: uuidv7(),
        org_id: orgId,
        project_id: project.id,
        public_key: generatePublicKey(),
        revoked_at: null,
      })
      .execute()
    return project
  })
}

export async function updateProject(db: Db, orgId: string, projectId: string, input: ProjectInput) {
  return db
    .updateTable('project')
    .set({
      name: input.name.trim(),
      slug: await uniqueSlug(db, orgId, input.name, projectId),
      url: input.url,
      updated_at: new Date(),
    })
    .where('org_id', '=', orgId)
    .where('id', '=', projectId)
    .returningAll()
    .executeTakeFirst()
}

export async function deleteProject(db: Db, orgId: string, projectId: string) {
  const result = await db
    .deleteFrom('project')
    .where('org_id', '=', orgId)
    .where('id', '=', projectId)
    .executeTakeFirst()
  return result.numDeletedRows > 0n
}

export function listProjectKeys(db: Db, orgId: string, projectId: string) {
  return db
    .selectFrom('project_key')
    .selectAll()
    .where('org_id', '=', orgId)
    .where('project_id', '=', projectId)
    .where('revoked_at', 'is', null)
    .orderBy('created_at')
    .execute()
}

/** Builds a Sentry-compatible DSN for a product: https://<public_key>@<ingest host>/<ingest_id>. */
export function sentryDsn(ingestUrl: string, publicKey: string, ingestId: string): string {
  const url = new URL(ingestUrl)
  return `${url.protocol}//${publicKey}@${url.host}/${ingestId}`
}
