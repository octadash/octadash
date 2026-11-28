import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { migrateToLatest } from './migrate'
import {
  createMonitor,
  deleteMonitor,
  dismissSameServer,
  getMonitor,
  isHeartbeatToken,
  listActiveMonitors,
  listMonitors,
  setMonitorStatus,
  updateMonitor,
} from './monitors'
import { createProject } from './projects'
import { createSource, deleteSource } from './sources'

const url = process.env.DATABASE_URL
const orgA = '00000000-0000-4000-8000-0000000000a1'
const orgB = '00000000-0000-4000-8000-0000000000b1'

describe.skipIf(!url)('monitors (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })

  beforeAll(async () => {
    await migrateToLatest(db)
    await db.deleteFrom('project').where('org_id', 'in', [orgA, orgB]).execute()
  })
  afterAll(async () => {
    await db.deleteFrom('project').where('org_id', 'in', [orgA, orgB]).execute()
    await pool.end()
  })

  it('creates site and heartbeat monitors, scoped to the organization', async () => {
    const project = await createProject(db, orgA, { name: 'Monitored' })
    const site = await createMonitor(db, orgA, project.id, {
      name: ' Site ',
      kind: 'site',
      url: 'https://example.com',
      intervalSeconds: 60,
      graceSeconds: 0,
    })
    expect(site).toMatchObject({
      name: 'Site',
      kind: 'site',
      heartbeat_token: null,
      status: 'unknown',
    })

    const beat = await createMonitor(db, orgA, project.id, {
      name: 'Backup',
      kind: 'heartbeat',
      url: 'https://ignored.example.com',
      intervalSeconds: 3600,
      graceSeconds: 600,
    })
    expect(beat?.url).toBeNull()
    expect(isHeartbeatToken(beat?.heartbeat_token ?? '')).toBe(true)

    // Another organization cannot add monitors to this product.
    expect(
      await createMonitor(db, orgB, project.id, {
        name: 'X',
        kind: 'site',
        url: 'https://x.example.com',
        intervalSeconds: 60,
        graceSeconds: 0,
      }),
    ).toBeNull()
    expect(await listMonitors(db, orgA, project.id)).toHaveLength(2)
    expect(await listMonitors(db, orgB, project.id)).toHaveLength(0)
    expect(await deleteMonitor(db, orgB, site?.id ?? '')).toBe(false)
  })

  it('links a monitor to a source of its own product, and keeps it when the source goes', async () => {
    const project = await createProject(db, orgA, { name: 'Linked' })
    const other = await createProject(db, orgA, { name: 'Other' })
    const docs = await createSource(db, orgA, project.id, {
      name: 'Docs',
      platform: 'nextjs',
      areas: ['traffic'],
    })
    const elsewhere = await createSource(db, orgA, other.id, {
      name: 'Elsewhere',
      platform: 'nextjs',
      areas: [],
    })
    const input = {
      name: 'Docs',
      kind: 'site' as const,
      url: 'https://docs.example.com',
      intervalSeconds: 60,
      graceSeconds: 0,
    }
    const linked = await createMonitor(db, orgA, project.id, { ...input, sourceId: docs?.id })
    expect(linked?.source_id).toBe(docs?.id)
    // A source of another product is not linked.
    const stray = await createMonitor(db, orgA, project.id, { ...input, sourceId: elsewhere?.id })
    expect(stray?.source_id).toBeNull()

    // Editing without a source drops the link; with one, sets it again.
    await updateMonitor(db, orgA, linked?.id ?? '', { ...input, sourceId: null })
    expect((await getMonitor(db, orgA, linked?.id ?? ''))?.source_id).toBeNull()
    await updateMonitor(db, orgA, linked?.id ?? '', { ...input, sourceId: docs?.id })
    expect((await getMonitor(db, orgA, linked?.id ?? ''))?.source_id).toBe(docs?.id)

    await deleteSource(db, orgA, docs?.id ?? '')
    const kept = await getMonitor(db, orgA, linked?.id ?? '')
    expect(kept?.name).toBe('Docs')
    expect(kept?.source_id).toBeNull()
  })

  it('closes the same-server notice only for the monitors given, in the organization', async () => {
    const project = await createProject(db, orgA, { name: 'Same server' })
    const monitor = await createMonitor(db, orgA, project.id, {
      name: 'Site',
      kind: 'site',
      url: 'https://example.com',
      intervalSeconds: 60,
      graceSeconds: 0,
    })
    await dismissSameServer(db, orgB, [monitor?.id ?? ''])
    expect((await getMonitor(db, orgA, monitor?.id ?? ''))?.same_server_dismissed_at).toBeNull()
    await dismissSameServer(db, orgA, [monitor?.id ?? ''])
    expect(
      (await getMonitor(db, orgA, monitor?.id ?? ''))?.same_server_dismissed_at,
    ).toBeInstanceOf(Date)
    await dismissSameServer(db, orgA, ['', 'not-an-id'])
  })

  it('changes status only from the expected state', async () => {
    const project = await createProject(db, orgA, { name: 'Status' })
    const monitor = await createMonitor(db, orgA, project.id, {
      name: 'API',
      kind: 'health',
      url: 'https://example.com/health',
      intervalSeconds: 60,
      graceSeconds: 0,
    })
    const id = monitor?.id ?? ''
    const at = new Date('2026-11-28T10:00:00Z')
    expect(await setMonitorStatus(db, id, 'unknown', 'down', at)).toBe(true)
    expect(await setMonitorStatus(db, id, 'unknown', 'down', at)).toBe(false)

    const paused = await updateMonitor(db, orgA, id, {
      name: 'API',
      url: 'https://example.com/health',
      intervalSeconds: 120,
      graceSeconds: 0,
      paused: true,
    })
    expect(paused).toMatchObject({ status: 'down', interval_seconds: 120, paused: true })
    expect((await listActiveMonitors(db)).some((m) => m.id === id)).toBe(false)
  })
})
