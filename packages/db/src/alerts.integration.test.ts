import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acknowledgeIncidents,
  claimPendingIncidents,
  closeStaleMonitorIncidents,
  listIncidentsBetween,
  listOpenIncidents,
  listRuleOverrides,
  listRules,
  markNotified,
  openIncident,
  resolveIncident,
  saveRule,
} from './alerts'
import { createChannel, deleteChannel, listChannels } from './channels'
import { createDb } from './client'
import { migrateToLatest } from './migrate'
import { createMonitor, setMonitorStatus } from './monitors'
import { createProject } from './projects'

const url = process.env.DATABASE_URL
const org = '00000000-0000-4000-8000-0000000000d1'
const other = '00000000-0000-4000-8000-0000000000d2'

describe.skipIf(!url)('alerts (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })
  const T0 = new Date('2026-11-28T12:00:00Z')

  beforeAll(async () => {
    await migrateToLatest(db)
    await db.deleteFrom('project').where('org_id', 'in', [org, other]).execute()
    await db.deleteFrom('alert_rule').where('org_id', 'in', [org, other]).execute()
    await db.deleteFrom('channel').where('org_id', 'in', [org, other]).execute()
  })
  afterAll(async () => {
    await db.deleteFrom('project').where('org_id', 'in', [org, other]).execute()
    await db.deleteFrom('alert_rule').where('org_id', 'in', [org, other]).execute()
    await db.deleteFrom('channel').where('org_id', 'in', [org, other]).execute()
    await pool.end()
  })

  it('seeds rules and lets a product override them', async () => {
    const project = await createProject(db, org, { name: 'Rules' })
    const defaults = await listRules(db, org, null)
    expect(defaults.find((r) => r.kind === 'monitor_down')).toMatchObject({
      level: 'emergency',
      params: { minutes: 2 },
      overridden: false,
    })
    await saveRule(db, org, project.id, 'monitor_down', {
      level: 'emergency',
      params: { minutes: 5 },
      channelIds: null,
    })
    const own = await listRules(db, org, project.id)
    expect(own.find((r) => r.kind === 'monitor_down')).toMatchObject({
      params: { minutes: 5 },
      overridden: true,
    })
    expect((await listRules(db, org, null)).find((r) => r.kind === 'monitor_down')?.params).toEqual(
      { minutes: 2 },
    )
    expect(await listRuleOverrides(db, org)).toContainEqual({
      kind: 'monitor_down',
      level: 'emergency',
      params: { minutes: 5 },
      product: { name: 'Rules', slug: project.slug },
    })
    // Another organization cannot override this product.
    expect(
      await saveRule(db, other, project.id, 'monitor_down', {
        level: 'off',
        params: {},
        channelIds: null,
      }),
    ).toBe(false)
  })

  it('opens one incident per key, waits its delay, and closes blips silently', async () => {
    const project = await createProject(db, org, { name: 'Incidents' })
    const input = {
      orgId: org,
      projectId: project.id,
      kind: 'monitor_down' as const,
      dedupeKey: `monitor:${project.id}:down`,
      data: { name: 'Site' },
      at: T0,
    }
    const first = await openIncident(db, input)
    expect(first?.notify_after.toISOString()).toBe('2026-11-28T12:02:00.000Z')
    expect(await openIncident(db, { ...input, at: new Date(T0.getTime() + 1000) })).toBeNull()

    const before = await db
      .transaction()
      .execute((trx) => claimPendingIncidents(trx, new Date(T0.getTime() + 60_000)))
    expect(before.some((i) => i.id === first?.id)).toBe(false)
    const due = await db
      .transaction()
      .execute((trx) => claimPendingIncidents(trx, new Date(T0.getTime() + 121_000)))
    expect(due.some((i) => i.id === first?.id)).toBe(true)
    await markNotified(db, [first?.id ?? ''], 'open', T0)

    expect(
      await acknowledgeIncidents(
        db,
        other,
        [first?.id ?? ''],
        '00000000-0000-4000-8000-0000000000a2',
        T0,
      ),
    ).toEqual([])
    expect(
      await acknowledgeIncidents(
        db,
        org,
        [first?.id ?? ''],
        '00000000-0000-4000-8000-0000000000a1',
        T0,
      ),
    ).toEqual([first?.id])
    // The first person keeps it.
    expect(
      await acknowledgeIncidents(
        db,
        org,
        [first?.id ?? ''],
        '00000000-0000-4000-8000-0000000000a2',
        T0,
      ),
    ).toEqual([])
    expect((await listOpenIncidents(db, org)).find((i) => i.id === first?.id)).toMatchObject({
      acknowledged_by: '00000000-0000-4000-8000-0000000000a1',
    })

    await resolveIncident(db, input.dedupeKey, new Date(T0.getTime() + 300_000))
    const resolved = await db
      .transaction()
      .execute((trx) => claimPendingIncidents(trx, new Date(T0.getTime() + 301_000)))
    expect(resolved.find((i) => i.id === first?.id)?.resolved_at).not.toBeNull()
    await markNotified(db, [first?.id ?? ''], 'resolve', T0)

    // A blip: down and back before the delay. Nobody is told, either way.
    const blip = await openIncident(db, { ...input, at: new Date(T0.getTime() + 400_000) })
    expect(blip).not.toBeNull()
    await resolveIncident(db, input.dedupeKey, new Date(T0.getTime() + 430_000))
    const after = await db
      .transaction()
      .execute((trx) => claimPendingIncidents(trx, new Date(T0.getTime() + 900_000)))
    expect(after.some((i) => i.id === blip?.id)).toBe(false)

    // The timeline of a period: whatever was open at some point of it.
    const at = (ms: number) => new Date(T0.getTime() + ms)
    const between = await listIncidentsBetween(db, org, [project.id], at(200_000), at(410_000))
    expect(between.map((i) => i.id)).toEqual([first?.id, blip?.id])
    expect(await listIncidentsBetween(db, org, null, at(500_000), at(600_000))).toEqual([])
    expect(await listIncidentsBetween(db, org, [], T0, at(600_000))).toEqual([])
    expect(await listIncidentsBetween(db, other, null, T0, at(600_000))).toEqual([])
  })

  it('does not open incidents for a rule that is off', async () => {
    const project = await createProject(db, org, { name: 'Off' })
    await saveRule(db, org, project.id, 'cert_expiring', {
      level: 'off',
      params: { days: 7 },
      channelIds: null,
    })
    expect(
      await openIncident(db, {
        orgId: org,
        projectId: project.id,
        kind: 'cert_expiring',
        dedupeKey: `cert:${project.id}`,
        data: {},
        at: T0,
      }),
    ).toBeNull()
  })

  it('stores channels per organization', async () => {
    const channel = await createChannel(db, org, {
      integration: 'telegram',
      name: 'Telegram',
      locale: 'pt-BR',
      config: { chatId: '1' },
      secrets: { botToken: 'v1.x.y.z' },
      enabled: true,
    })
    expect((await listChannels(db, org)).map((c) => c.id)).toContain(channel.id)
    expect(await listChannels(db, other)).toHaveLength(0)
    await deleteChannel(db, other, channel.id)
    expect(await listChannels(db, org)).toHaveLength(1)
  })

  it('closes, without a message, the outage of a monitor someone paused', async () => {
    const project = await createProject(db, org, { name: 'Paused' })
    const monitor = await createMonitor(db, org, project.id, {
      name: 'Site',
      kind: 'site',
      url: 'https://example.com',
      intervalSeconds: 60,
      graceSeconds: 0,
    })
    if (!monitor) throw new Error('monitor not created')
    await setMonitorStatus(db, monitor.id, 'unknown', 'down', T0)
    const dedupeKey = `monitor:${monitor.id}:down`
    await openIncident(db, {
      orgId: org,
      projectId: project.id,
      monitorId: monitor.id,
      kind: 'monitor_down',
      dedupeKey,
      data: {},
      at: T0,
    })
    expect(await closeStaleMonitorIncidents(db, T0)).toEqual([])
    await db.updateTable('monitor').set({ paused: true }).where('id', '=', monitor.id).execute()
    expect(await closeStaleMonitorIncidents(db, T0)).toEqual([org])
    const row = await db
      .selectFrom('incident')
      .selectAll()
      .where('dedupe_key', '=', dedupeKey)
      .executeTakeFirstOrThrow()
    expect(row.resolved_at).not.toBeNull()
    expect(row.notified_resolve_at).not.toBeNull()
  })
})
