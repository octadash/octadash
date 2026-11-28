import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { createGroup, deleteGroup, getGroupBySlug, listGroups, updateGroup } from './groups'
import { migrateToLatest } from './migrate'
import { createProject, deleteProject } from './projects'

const url = process.env.DATABASE_URL
const org = '00000000-0000-4000-8000-0000000000e1'
const other = '00000000-0000-4000-8000-0000000000e2'

describe.skipIf(!url)('groups (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })

  beforeAll(async () => {
    await migrateToLatest(db)
    await db.deleteFrom('product_group').where('org_id', 'in', [org, other]).execute()
    await db.deleteFrom('project').where('org_id', 'in', [org, other]).execute()
  })
  afterAll(async () => {
    await db.deleteFrom('product_group').where('org_id', 'in', [org, other]).execute()
    await db.deleteFrom('project').where('org_id', 'in', [org, other]).execute()
    await pool.end()
  })

  it('groups products of the organization only', async () => {
    const a = await createProject(db, org, { name: 'Kitebox' })
    const b = await createProject(db, org, { name: 'Lumen' })
    const foreign = await createProject(db, other, { name: 'Alheio' })
    const group = await createGroup(db, org, {
      name: 'Clientes',
      projectIds: [a.id, b.id, foreign.id],
    })
    expect(group.slug).toBe('clientes')
    const listed = await getGroupBySlug(db, org, 'clientes')
    expect(new Set(listed?.project_ids)).toEqual(new Set([a.id, b.id]))
    expect(await listGroups(db, other)).toHaveLength(0)

    // Same name again gets its own address.
    expect((await createGroup(db, org, { name: 'Clientes', projectIds: [] })).slug).toBe(
      'clientes-2',
    )
    expect((await getGroupBySlug(db, org, 'clientes-2'))?.project_ids).toEqual([])

    await updateGroup(db, org, group.id, { name: 'Clientes VIP', projectIds: [b.id] })
    expect((await getGroupBySlug(db, org, 'clientes-vip'))?.project_ids).toEqual([b.id])
    expect(await updateGroup(db, other, group.id, { name: 'X', projectIds: [] })).toBeUndefined()

    // Deleting a product takes it out of its groups; deleting a group keeps its products.
    await deleteProject(db, org, b.id)
    expect((await getGroupBySlug(db, org, 'clientes-vip'))?.project_ids).toEqual([])
    await deleteGroup(db, org, group.id)
    expect(await getGroupBySlug(db, org, 'clientes-vip')).toBeUndefined()
  })
})
