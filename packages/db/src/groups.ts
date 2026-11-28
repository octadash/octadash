import { slugify, uuidv7 } from '@octadash/core'
import { sql } from 'kysely'
import type { Db } from './client'

/** A group with the ids of its products, all scoped to one organization. */
export interface GroupInput {
  name: string
  projectIds: string[]
}

export async function listGroups(db: Db, orgId: string) {
  const rows = await db
    .selectFrom('product_group')
    .leftJoin('product_group_member', 'product_group_member.group_id', 'product_group.id')
    .select([
      'product_group.id',
      'product_group.name',
      'product_group.slug',
      sql<
        string[]
      >`coalesce(array_agg(product_group_member.project_id) filter (where product_group_member.project_id is not null), '{}')`.as(
        'project_ids',
      ),
    ])
    .where('product_group.org_id', '=', orgId)
    .groupBy(['product_group.id', 'product_group.name', 'product_group.slug'])
    .orderBy('product_group.name')
    .execute()
  return rows
}

export type Group = Awaited<ReturnType<typeof listGroups>>[number]

export async function getGroupBySlug(db: Db, orgId: string, slug: string) {
  return (await listGroups(db, orgId)).find((group) => group.slug === slug)
}

async function uniqueSlug(db: Db, orgId: string, name: string, exceptId?: string) {
  const base = slugify(name)
  const taken = new Set(
    (
      await db
        .selectFrom('product_group')
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

/** Keeps only products of the organization, so a group never reaches another tenant. */
async function ownedProjects(db: Db, orgId: string, projectIds: string[]) {
  if (projectIds.length === 0) return []
  const rows = await db
    .selectFrom('project')
    .select('id')
    .where('org_id', '=', orgId)
    .where('id', 'in', projectIds)
    .execute()
  return rows.map((row) => row.id)
}

async function setMembers(db: Db, groupId: string, projectIds: string[]) {
  await db.deleteFrom('product_group_member').where('group_id', '=', groupId).execute()
  if (projectIds.length === 0) return
  await db
    .insertInto('product_group_member')
    .values(projectIds.map((projectId) => ({ group_id: groupId, project_id: projectId })))
    .execute()
}

export async function createGroup(db: Db, orgId: string, input: GroupInput) {
  return db.transaction().execute(async (trx) => {
    const group = await trx
      .insertInto('product_group')
      .values({
        id: uuidv7(),
        org_id: orgId,
        name: input.name.trim(),
        slug: await uniqueSlug(trx, orgId, input.name),
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    await setMembers(trx, group.id, await ownedProjects(trx, orgId, input.projectIds))
    return group
  })
}

export async function updateGroup(db: Db, orgId: string, groupId: string, input: GroupInput) {
  return db.transaction().execute(async (trx) => {
    const group = await trx
      .updateTable('product_group')
      .set({
        name: input.name.trim(),
        slug: await uniqueSlug(trx, orgId, input.name, groupId),
        updated_at: new Date(),
      })
      .where('org_id', '=', orgId)
      .where('id', '=', groupId)
      .returningAll()
      .executeTakeFirst()
    if (!group) return undefined
    await setMembers(trx, group.id, await ownedProjects(trx, orgId, input.projectIds))
    return group
  })
}

export async function deleteGroup(db: Db, orgId: string, groupId: string) {
  await db
    .deleteFrom('product_group')
    .where('org_id', '=', orgId)
    .where('id', '=', groupId)
    .execute()
}
