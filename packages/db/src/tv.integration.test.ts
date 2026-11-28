import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listHappenings, openIncident, resolveIncident } from './alerts'
import { createDb } from './client'
import { migrateToLatest } from './migrate'
import { createProject } from './projects'
import { createTvLink, getTvLink, openTvLink, stopTvLink } from './tv'

const url = process.env.DATABASE_URL
const org = '00000000-0000-4000-8000-0000000002e1'
const other = '00000000-0000-4000-8000-0000000002e2'

describe.skipIf(!url)('TV mode (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })
  const settings = { scope: 'all', metrics: ['visitorsNow'], perPage: 9, sound: false }

  beforeAll(async () => {
    await migrateToLatest(db)
    await db.deleteFrom('project').where('org_id', 'in', [org, other]).execute()
    await db.deleteFrom('tv_link').where('org_id', 'in', [org, other]).execute()
  })
  afterAll(async () => {
    await db.deleteFrom('project').where('org_id', 'in', [org, other]).execute()
    await db.deleteFrom('tv_link').where('org_id', 'in', [org, other]).execute()
    await pool.end()
  })

  it('keeps one private link per organization, stored as a hash', async () => {
    const first = await createTvLink(db, org, null, settings)
    expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(await openTvLink(db, first)).toEqual({ orgId: org, settings })
    const second = await createTvLink(db, org, null, { ...settings, perPage: 6 })
    // A new link stops the one before.
    expect(await openTvLink(db, first)).toBeUndefined()
    expect((await openTvLink(db, second))?.settings).toMatchObject({ perPage: 6 })
    expect((await getTvLink(db, org))?.last_opened_at).toBeInstanceOf(Date)
    const stored = await db.selectFrom('tv_link').select('token_hash').execute()
    expect(stored.map((r) => r.token_hash)).not.toContain(second)
    expect(await stopTvLink(db, other)).toBe(false)
    expect(await stopTvLink(db, org)).toBe(true)
    expect(await openTvLink(db, second)).toBeUndefined()
    expect(await getTvLink(db, org)).toBeUndefined()
    expect(await openTvLink(db, 'not a token')).toBeUndefined()
  })

  it('lists what happened, newest first', async () => {
    const project = await createProject(db, org, { name: 'TV Shop' })
    const T0 = new Date('2026-11-28T10:00:00Z')
    const input = {
      orgId: org,
      projectId: project.id,
      kind: 'monitor_down' as const,
      dedupeKey: `monitor:${project.id}:down`,
      data: { name: 'Site' },
      at: T0,
    }
    await openIncident(db, input)
    await resolveIncident(db, input.dedupeKey, new Date(T0.getTime() + 600_000))
    const later = new Date(T0.getTime() + 3_600_000)
    const happened = await listHappenings(db, org, new Date(T0.getTime() - 1), 10, later)
    expect(happened.map((h) => [h.kind, h.product, h.name])).toEqual([
      ['back', 'TV Shop', 'Site'],
      ['down', 'TV Shop', 'Site'],
    ])
    expect(await listHappenings(db, other, new Date(0), 10, later)).toEqual([])
  })
})
