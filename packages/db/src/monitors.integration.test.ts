import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { migrateToLatest } from './migrate'
import {
  createMonitor,
  deleteMonitor,
  isHeartbeatToken,
  listActiveMonitors,
  listMonitors,
  setMonitorStatus,
  updateMonitor,
} from './monitors'
import { createProject } from './projects'

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
