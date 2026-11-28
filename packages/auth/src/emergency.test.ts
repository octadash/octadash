import {
  acknowledgeIncidents,
  addIncidentNote,
  closeIncident,
  createChannel,
  createDb,
  createProject,
  getIncident,
  listIncidentEvents,
  listIncidentNotifications,
  openIncident,
  previousIncident,
  recordNotification,
  resolveIncident,
  takeIncidents,
} from '@octadash/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrateAll } from './migrate'

const url = process.env.DATABASE_URL
const org = '00000000-0000-4000-8000-0000000000e8'

describe.skipIf(!url)('one emergency (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })
  const T0 = new Date('2026-11-28T21:22:00Z')
  const minutes = (n: number) => new Date(T0.getTime() + n * 60_000)
  const users: Record<'ana' | 'bruno', string> = { ana: '', bruno: '' }
  const clean = async () => {
    await db.deleteFrom('project').where('org_id', '=', org).execute()
    await db.deleteFrom('alert_rule').where('org_id', '=', org).execute()
    await db.deleteFrom('notification').where('org_id', '=', org).execute()
    await db.deleteFrom('channel').where('org_id', '=', org).execute()
    await pool.query("delete from auth_user where email like '%@emergency.test'")
  }

  beforeAll(async () => {
    await migrateAll(db, pool)
    await clean()
    for (const name of ['ana', 'bruno'] as const) {
      const { rows } = await pool.query<{ id: string }>(
        `insert into auth_user (name, email, "emailVerified", "createdAt", "updatedAt")
        values ($1, $2, false, now(), now()) returning id`,
        [name === 'ana' ? 'Ana' : 'Bruno', `${name}@emergency.test`],
      )
      users[name] = rows[0]?.id as string
    }
  })
  afterAll(async () => {
    await clean()
    await pool.end()
  })

  it('keeps who took it, the notes, the messages and who closed it', async () => {
    const project = await createProject(db, org, { name: 'Acme API' })
    const open = (at: Date) =>
      openIncident(db, {
        orgId: org,
        projectId: project.id,
        kind: 'monitor_down',
        dedupeKey: 'monitor:x:down',
        data: { name: 'API', reason: 'HTTP 502' },
        at,
      })
    const earlier = await open(minutes(-60 * 24))
    await resolveIncident(db, 'monitor:x:down', minutes(-60 * 24 + 4))
    const incident = await open(T0)
    if (!earlier || !incident) throw new Error('not opened')

    // Ana says she is on it; the strip's "I'm on it" leaves a line too.
    expect(await acknowledgeIncidents(db, org, [incident.id], users.ana, minutes(8))).toEqual([
      incident.id,
    ])
    expect(await addIncidentNote(db, org, incident.id, users.ana, 'Rolling back.', minutes(12)))
    // Bruno takes it over; taking it again changes nothing.
    expect(await takeIncidents(db, org, [incident.id], users.bruno, minutes(20))).toEqual([
      incident.id,
    ])
    expect(await takeIncidents(db, org, [incident.id], users.bruno, minutes(21))).toEqual([])
    const channel = await createChannel(db, org, {
      integration: 'webhook',
      name: 'Automation',
      locale: 'en',
      config: {},
      secrets: {},
      enabled: true,
    })
    await recordNotification(db, {
      orgId: org,
      channelId: channel.id,
      incidentIds: [incident.id],
      event: 'open',
      ok: false,
      error: '502 from the webhook',
    })

    const detail = await getIncident(db, org, incident.id)
    expect(detail).toMatchObject({ project_name: 'Acme API', acknowledged_name: 'Bruno' })
    expect(await previousIncident(db, org, 'monitor:x:down', T0)).toMatchObject({ id: earlier.id })

    expect(await closeIncident(db, org, incident.id, users.bruno, 'False alarm.', minutes(30)))
    expect(await closeIncident(db, org, incident.id, users.bruno, 'Again.', minutes(31))).toBe(
      false,
    )
    const events = await listIncidentEvents(db, org, incident.id)
    expect(events.map((e) => [e.kind, e.user_name, e.body])).toEqual([
      ['took', 'Ana', null],
      ['note', 'Ana', 'Rolling back.'],
      ['took', 'Bruno', null],
      ['closed', 'Bruno', 'False alarm.'],
    ])
    const sent = await listIncidentNotifications(db, org, incident.id)
    expect(sent.map((n) => [n.event, n.channel_name, n.ok, n.error])).toEqual([
      ['open', 'Automation', false, '502 from the webhook'],
    ])
    expect((await getIncident(db, org, incident.id))?.resolved_at).toEqual(minutes(30))
  })
})
