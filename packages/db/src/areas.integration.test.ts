import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isArea, listProjectAreas, setProjectArea } from './areas'
import { createDb } from './client'
import { migrateToLatest } from './migrate'
import { createProject } from './projects'

const url = process.env.DATABASE_URL
const orgA = '00000000-0000-4000-8000-0000000000aa'
const orgB = '00000000-0000-4000-8000-0000000000bb'

describe('isArea', () => {
  it('knows the areas', () => {
    expect(isArea('errors')).toBe(true)
    expect(isArea('settings')).toBe(false)
  })
})

describe.skipIf(!url)('project areas (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })

  beforeAll(async () => {
    await migrateToLatest(db)
    await db.deleteFrom('project').where('org_id', 'in', [orgA, orgB]).execute()
  })
  afterAll(async () => {
    await db.deleteFrom('project').where('org_id', 'in', [orgA, orgB]).execute()
    await pool.end()
  })

  it('stores, changes and clears an area state', async () => {
    const project = await createProject(db, orgA, { name: 'Areas' })
    expect((await listProjectAreas(db, orgA, project.id)).size).toBe(0)
    await setProjectArea(db, orgA, project.id, 'logs', 'dismissed')
    await setProjectArea(db, orgA, project.id, 'money', 'dismissed')
    await setProjectArea(db, orgA, project.id, 'money', 'set_up')
    expect(Object.fromEntries(await listProjectAreas(db, orgA, project.id))).toEqual({
      logs: 'dismissed',
      money: 'set_up',
    })
    await setProjectArea(db, orgA, project.id, 'logs', null)
    expect([...(await listProjectAreas(db, orgA, project.id)).keys()]).toEqual(['money'])
  })

  it('never writes into another organization', async () => {
    const project = await createProject(db, orgA, { name: 'Areas 2' })
    await setProjectArea(db, orgB, project.id, 'logs', 'dismissed')
    expect((await listProjectAreas(db, orgA, project.id)).size).toBe(0)
  })
})
