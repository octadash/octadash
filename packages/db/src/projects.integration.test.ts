import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { migrateToLatest } from './migrate'
import {
  createProject,
  deleteProject,
  findIngestKey,
  getProjectBySlug,
  listProjectKeys,
  listProjects,
  sentryDsn,
  updateProject,
} from './projects'

const url = process.env.DATABASE_URL
const orgA = '00000000-0000-4000-8000-00000000000a'
const orgB = '00000000-0000-4000-8000-00000000000b'

describe('sentryDsn', () => {
  it('builds a DSN Sentry SDKs accept', () => {
    expect(sentryDsn('https://ingest.example.com', 'abc', '7')).toBe(
      'https://abc@ingest.example.com/7',
    )
  })
})

describe.skipIf(!url)('projects (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })

  beforeAll(async () => {
    await migrateToLatest(db)
    await db.deleteFrom('project').where('org_id', 'in', [orgA, orgB]).execute()
  })
  afterAll(async () => {
    await db.deleteFrom('project').where('org_id', 'in', [orgA, orgB]).execute()
    await pool.end()
  })

  it('creates a product with a unique slug and an ingest key', async () => {
    const first = await createProject(db, orgA, { name: 'Postato' })
    const second = await createProject(db, orgA, { name: 'Postato' })
    expect(first.slug).toBe('postato')
    expect(second.slug).toBe('postato-2')
    expect(Number(first.ingest_id)).toBeGreaterThan(0)
    const keys = await listProjectKeys(db, orgA, first.id)
    expect(keys).toHaveLength(1)
    expect(keys[0]?.public_key).toMatch(/^[0-9a-f]{32}$/)
    expect(await findIngestKey(db, keys[0]?.public_key ?? '')).toEqual({
      org_id: orgA,
      project_id: first.id,
      source_id: null,
      visitor_mode: 'daily',
    })
    expect(await findIngestKey(db, 'f'.repeat(32))).toBeUndefined()
  })

  it('keeps tenants apart', async () => {
    await createProject(db, orgB, { name: 'Postato' })
    expect((await listProjects(db, orgB)).map((p) => p.slug)).toEqual(['postato'])
    const ofA = await getProjectBySlug(db, orgA, 'postato')
    expect(ofA).toBeDefined()
    expect(await deleteProject(db, orgB, ofA?.id ?? '')).toBe(false)
    expect(await updateProject(db, orgB, ofA?.id ?? '', { name: 'Hacked' })).toBeUndefined()
  })

  it('renames and deletes', async () => {
    const project = await getProjectBySlug(db, orgA, 'postato-2')
    const renamed = await updateProject(db, orgA, project?.id ?? '', { name: 'Intelibot' })
    expect(renamed?.slug).toBe('intelibot')
    expect(await deleteProject(db, orgA, project?.id ?? '')).toBe(true)
    expect(await listProjectKeys(db, orgA, project?.id ?? '')).toEqual([])
  })
})
