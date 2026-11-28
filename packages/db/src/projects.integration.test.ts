import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { migrateToLatest } from './migrate'
import {
  createProject,
  deleteProject,
  findIngestKey,
  getProjectBySlug,
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

  it('creates a product with a unique slug and no key until it has sources', async () => {
    const first = await createProject(db, orgA, { name: 'Pagebird' })
    const second = await createProject(db, orgA, { name: 'Pagebird' })
    expect(first.slug).toBe('pagebird')
    expect(second.slug).toBe('pagebird-2')
    expect(Number(first.ingest_id)).toBeGreaterThan(0)
    const keys = await db.selectFrom('source_key').where('project_id', '=', first.id).execute()
    expect(keys).toHaveLength(0)
    expect(await findIngestKey(db, 'f'.repeat(32))).toBeUndefined()
  })

  it('keeps old addresses working after a rename', async () => {
    const product = await createProject(db, orgA, { name: 'Renamed Shop' })
    const renamed = await updateProject(db, orgA, product.id, { name: 'New Shop' })
    expect(renamed?.slug).toBe('new-shop')
    expect((await getProjectBySlug(db, orgA, 'renamed-shop'))?.id).toBe(product.id)
    expect((await getProjectBySlug(db, orgB, 'renamed-shop'))?.id).toBeUndefined()
    // Back to the first name: the address is its own again, not an alias.
    await updateProject(db, orgA, product.id, { name: 'Renamed Shop' })
    expect((await getProjectBySlug(db, orgA, 'new-shop'))?.id).toBe(product.id)
    // A product created with the old address of another holds it.
    const taker = await createProject(db, orgA, { name: 'New Shop' })
    expect((await getProjectBySlug(db, orgA, 'new-shop'))?.id).toBe(taker.id)
    expect(await updateProject(db, orgB, product.id, { name: 'X' })).toBeUndefined()
  })

  it('keeps tenants apart', async () => {
    await createProject(db, orgB, { name: 'Pagebird' })
    expect((await listProjects(db, orgB)).map((p) => p.slug)).toEqual(['pagebird'])
    const ofA = await getProjectBySlug(db, orgA, 'pagebird')
    expect(ofA).toBeDefined()
    expect(await deleteProject(db, orgB, ofA?.id ?? '')).toBe(false)
    expect(await updateProject(db, orgB, ofA?.id ?? '', { name: 'Hacked' })).toBeUndefined()
  })

  it('renames and deletes', async () => {
    const project = await getProjectBySlug(db, orgA, 'pagebird-2')
    const renamed = await updateProject(db, orgA, project?.id ?? '', { name: 'Kitebox' })
    expect(renamed?.slug).toBe('kitebox')
    expect(await deleteProject(db, orgA, project?.id ?? '')).toBe(true)
    expect(await getProjectBySlug(db, orgA, 'kitebox')).toBeUndefined()
  })
})
