import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listAreaDetails, setProjectArea } from './areas'
import { createDb } from './client'
import { migrateToLatest } from './migrate'
import { createProject, findIngestKey } from './projects'
import { addSourceAreas, listDismissedAreas, recordDiscarded } from './routing'
import {
  addSourceArea,
  createSource,
  deleteSource,
  getSource,
  listSourceKeys,
  listSources,
  renameSource,
  rotateSourceKey,
  setSourceVisitorMode,
  stopOldKey,
  updateSource,
} from './sources'

const url = process.env.DATABASE_URL
const org = '00000000-0000-4000-8000-0000000000f1'
const other = '00000000-0000-4000-8000-0000000000f2'

describe.skipIf(!url)('sources (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })

  beforeAll(async () => {
    await migrateToLatest(db)
    await db.deleteFrom('project').where('org_id', 'in', [org, other]).execute()
  })
  afterAll(async () => {
    await db.deleteFrom('project').where('org_id', 'in', [org, other]).execute()
    await pool.end()
  })

  it('gives each source its own key, which the ingest resolves', async () => {
    const project = await createProject(db, org, { name: 'Sources' })
    expect(
      await createSource(db, other, project.id, { name: 'X', platform: 'node', areas: [] }),
    ).toBeUndefined()
    const site = await createSource(db, org, project.id, {
      name: ' Site ',
      platform: 'nextjs',
      areas: ['usage', 'traffic', 'traffic'],
    })
    expect(site).toMatchObject({ name: 'Site', platform: 'nextjs', areas: ['traffic', 'usage'] })
    expect(site?.public_key).toMatch(/^[0-9a-f]{32}$/)
    expect(site?.visitor_mode).toBe('daily')
    expect(await findIngestKey(db, site?.public_key ?? '')).toEqual({
      org_id: org,
      project_id: project.id,
      source_id: site?.id,
      visitor_mode: 'daily',
    })
    expect(await setSourceVisitorMode(db, other, site?.id ?? '', 'persistent')).toBe(false)
    expect(await setSourceVisitorMode(db, org, site?.id ?? '', 'persistent')).toBe(true)
    expect(await findIngestKey(db, site?.public_key ?? '')).toMatchObject({
      visitor_mode: 'persistent',
    })
    expect((await listSources(db, org, project.id)).map((s) => s.public_key)).toEqual([
      site?.public_key,
    ])
  })

  it('rotates a key with an overlap, adds areas and deletes', async () => {
    const project = await createProject(db, org, { name: 'Rotate' })
    const api = await createSource(db, org, project.id, {
      name: 'API',
      platform: 'dotnet',
      areas: ['errors'],
    })
    const old = api?.public_key ?? ''
    const later = new Date(Date.now() + 3_600_000)
    const fresh = await rotateSourceKey(db, org, api?.id ?? '', later)
    expect(fresh).toMatch(/^[0-9a-f]{32}$/)
    expect(await findIngestKey(db, old)).toBeDefined()
    expect((await listSources(db, org, project.id))[0]?.public_key).toBe(fresh)
    expect((await getSource(db, org, api?.id ?? ''))?.public_key).toBe(fresh)
    expect(await getSource(db, other, api?.id ?? '')).toBeUndefined()
    const keys = await listSourceKeys(db, org, api?.id ?? '')
    expect(keys.map((k) => [k.public_key, k.revoked_at])).toEqual([
      [fresh, null],
      [old, later],
    ])
    // "Stop now" on the old key; the current one cannot be stopped that way.
    expect(await stopOldKey(db, org, keys[0]?.id ?? '')).toBe(false)
    expect(await stopOldKey(db, other, keys[1]?.id ?? '')).toBe(false)
    expect(await stopOldKey(db, org, keys[1]?.id ?? '')).toBe(true)
    expect(await findIngestKey(db, old)).toBeUndefined()
    expect(await listSourceKeys(db, org, api?.id ?? '')).toHaveLength(1)
    await rotateSourceKey(db, org, api?.id ?? '')
    expect(await findIngestKey(db, fresh ?? '')).toBeUndefined()

    expect(await addSourceArea(db, other, api?.id ?? '', 'logs')).toBe(false)
    expect(await addSourceArea(db, org, api?.id ?? '', 'logs')).toBe(true)
    await addSourceAreas(db, [{ source_id: api?.id ?? '', area: 'logs' }])
    expect((await listSources(db, org, project.id))[0]?.areas).toEqual(['errors', 'logs'])
    expect(
      await updateSource(db, org, api?.id ?? '', {
        name: 'Backend',
        platform: 'dotnet',
        areas: [],
      }),
    ).toBe(true)
    expect(await renameSource(db, other, api?.id ?? '', { name: 'X', platform: 'go' })).toBe(false)
    expect(await renameSource(db, org, api?.id ?? '', { name: ' Core ', platform: 'go' })).toBe(
      true,
    )
    expect((await getSource(db, org, api?.id ?? ''))?.name).toBe('Core')

    expect(await deleteSource(db, other, api?.id ?? '')).toBe(false)
    expect(await deleteSource(db, org, api?.id ?? '')).toBe(true)
    expect(await listSources(db, org, project.id)).toEqual([])
  })

  it('counts data for a dismissed area', async () => {
    const project = await createProject(db, org, { name: 'Dismissed' })
    await setProjectArea(db, org, project.id, 'usage', 'dismissed')
    const dismissed = await listDismissedAreas(db, [project.id])
    expect([...(dismissed.get(project.id) ?? [])]).toEqual(['usage'])
    const at = new Date('2026-11-28T12:00:00Z')
    await recordDiscarded(db, [{ project_id: project.id, area: 'usage', count: 3 }], at)
    await recordDiscarded(db, [{ project_id: project.id, area: 'usage', count: 2 }], at)
    const row = await db
      .selectFrom('project_area')
      .select(['discarded_events', 'discarded_at'])
      .where('project_id', '=', project.id)
      .executeTakeFirstOrThrow()
    expect(row).toEqual({ discarded_events: '5', discarded_at: at })
    expect((await listAreaDetails(db, org, project.id)).get('usage')).toMatchObject({
      state: 'dismissed',
      discarded: 5,
      discardedAt: at,
    })
  })
})
