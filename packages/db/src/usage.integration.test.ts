import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClickHouse } from './clickhouse/client'
import { type EventRow, insertEvents, NO_SOURCE, toClickHouseTime } from './clickhouse/events'
import { migrateClickHouse } from './clickhouse/migrate'
import {
  cameBackWeek1,
  funnelSteps,
  keyEventRates,
  lastUsageEvent,
  retentionCohorts,
  signupsByProduct,
  usageEvents,
  usageSeries,
  usageTotals,
} from './clickhouse/usage'
import { createDb } from './client'
import { migrateToLatest } from './migrate'
import { createProject } from './projects'
import {
  deleteFunnel,
  listFunnels,
  listKeyEvents,
  SIGNUP_EVENTS,
  saveFunnel,
  setKeyEvent,
} from './usage'

const url = process.env.DATABASE_URL
const chUrl = process.env.CLICKHOUSE_URL
const org = '00000000-0000-4000-8000-0000000003a1'
const DAY = 86_400_000
/** A Monday, so weeks are easy to read. */
const T0 = new Date('2026-11-02T12:00:00Z')
const at = (days: number, minutes = 0) => new Date(T0.getTime() + days * DAY + minutes * 60_000)

describe.skipIf(!url)('key events and funnels (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })
  let product = ''

  beforeAll(async () => {
    await migrateToLatest(db)
    await db.deleteFrom('project').where('org_id', '=', org).execute()
    product = (await createProject(db, org, { name: 'Usage Shop' })).id
  })
  afterAll(async () => {
    await db.deleteFrom('project').where('org_id', '=', org).execute()
    await pool.end()
  })

  it('marks and unmarks key events', async () => {
    await setKeyEvent(db, org, product, 'purchase_completed', true, null)
    await setKeyEvent(db, org, product, 'purchase_completed', true, null)
    await setKeyEvent(db, org, product, 'signed_up', true, null)
    expect((await listKeyEvents(db, org, [product])).map((k) => k.event)).toEqual([
      'purchase_completed',
      'signed_up',
    ])
    await setKeyEvent(db, org, product, 'signed_up', false, null)
    expect(await listKeyEvents(db, org, [product])).toEqual([
      { orgId: org, projectId: product, event: 'purchase_completed' },
    ])
    expect(await listKeyEvents(db, org, [])).toEqual([])
    expect(await listKeyEvents(db, null)).toContainEqual({
      orgId: org,
      projectId: product,
      event: 'purchase_completed',
    })
  })

  it('saves, changes and deletes funnels', async () => {
    const id = await saveFunnel(
      db,
      org,
      product,
      {
        name: 'Checkout',
        steps: ['$pageview', 'cart_item_added', 'purchase_completed'],
        windowDays: 7,
      },
      null,
    )
    expect(id).toBeTruthy()
    await saveFunnel(
      db,
      org,
      product,
      { name: 'Checkout', steps: ['cart_item_added', 'purchase_completed'], windowDays: 1 },
      null,
      id ?? '',
    )
    expect(await listFunnels(db, org, [product])).toEqual([
      {
        id,
        projectId: product,
        name: 'Checkout',
        steps: ['cart_item_added', 'purchase_completed'],
        windowDays: 1,
      },
    ])
    expect(await deleteFunnel(db, org, id ?? '')).toBe(true)
    expect(await listFunnels(db, org, [product])).toEqual([])
  })
})

describe.skipIf(!chUrl)('product usage queries (needs CLICKHOUSE_URL)', () => {
  const client = createClickHouse(chUrl ?? '')
  const project = '00000000-0000-4000-8000-0000000003a2'
  let n = 0
  const row = (time: Date, event: string, person: string, visitor = ''): EventRow => ({
    org_id: org,
    project_id: project,
    source_id: NO_SOURCE,
    uuid: `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`,
    timestamp: toClickHouseTime(time),
    received_at: toClickHouseTime(time),
    event,
    distinct_id: person,
    session_id: '',
    properties: '{}',
    visitor_id: visitor,
    is_bot: 0,
  })

  beforeAll(async () => {
    await migrateClickHouse(chUrl ?? '')
    await client.command({ query: `DELETE FROM events WHERE org_id = '${org}'` })
    await insertEvents(
      client,
      [
        // Week of Nov 2: a and b sign up; a comes back the next week, b does not.
        row(at(0), 'signed_up', 'a'),
        row(at(0, 5), 'cart_item_added', 'a'),
        row(at(0, 10), 'purchase_completed', 'a'),
        row(at(0, 1), 'signed_up', 'b'),
        row(at(0, 2), 'cart_item_added', 'b'),
        row(at(8), 'invite_sent', 'a'),
        // Week of Nov 9: c signs up and buys a day later, out of a 1-day window by 1 minute.
        row(at(7), 'signed_up', 'c'),
        row(at(7, 1), 'cart_item_added', 'c'),
        row(at(8, 2), 'purchase_completed', 'c'),
        // A purchase on its own, at noon on Nov 5: what the key event's normal reads.
        row(at(3), 'purchase_completed', 'd'),
        // A page view and an anonymous visitor event: traffic, and a person by the day's hash.
        row(at(0), '$pageview', '', 'v1'),
        row(at(0, 30), 'newsletter_subscribed', '', 'v1'),
      ],
      crypto.randomUUID(),
    )
  })
  afterAll(async () => {
    await client.close()
  })

  const scope = { orgId: org, projectIds: [project], from: at(0, -60), to: at(1) }
  const keys = [{ projectId: project, event: 'purchase_completed' }]

  it('counts active people, sign-ups and key events, and draws them', async () => {
    expect(await usageTotals(client, scope, SIGNUP_EVENTS, keys)).toEqual({
      active: 3,
      signups: 2,
      keyEvents: 1,
    })
    const series = await usageSeries(client, scope, 'hour', SIGNUP_EVENTS, keys)
    expect(series).toHaveLength(25)
    expect(series[1]).toMatchObject({ active: 3, signups: 2, keyEvents: 1 })
    const byProduct = await signupsByProduct(client, scope, SIGNUP_EVENTS)
    expect([...byProduct.values()].reduce((a, b) => a + b, 0)).toBe(2)
    expect(await signupsByProduct(client, { ...scope, projectIds: [] }, SIGNUP_EVENTS)).toEqual(
      new Map(),
    )
    expect(await usageTotals(client, { ...scope, projectIds: [] }, SIGNUP_EVENTS, keys)).toEqual({
      active: 0,
      signups: 0,
      keyEvents: 0,
    })
  })

  it('lists events with their people and the periods before', async () => {
    const week = { ...scope, from: at(7, -60), to: at(9) }
    const events = await usageEvents(client, week, [{ from: at(0, -60), to: at(2) }])
    expect(events.map((e) => [e.event, e.count, e.people, e.baseline[0]])).toEqual([
      ['cart_item_added', 1, 1, 2],
      ['invite_sent', 1, 1, 0],
      ['purchase_completed', 1, 1, 1],
      ['signed_up', 1, 1, 2],
      // Only in the baseline: counted there, with nothing now.
      ['newsletter_subscribed', 0, 0, 1],
    ])
    expect(events[0]?.last?.toISOString()).toBe(at(7, 1).toISOString())
    expect(events.at(-1)?.last).toBeNull()
  })

  it('reads who came back in week 1 and the weekly cohorts', async () => {
    const back = await cameBackWeek1(
      client,
      { ...scope, from: at(7, -60), to: at(8) },
      SIGNUP_EVENTS,
    )
    expect(back).toEqual({ people: 2, returned: 1 })
    const cohorts = await retentionCohorts(
      client,
      { orgId: org, projectIds: [project], to: at(14) },
      SIGNUP_EVENTS,
    )
    expect(cohorts).toEqual([
      { week: '2026-11-02', people: 2, active: [2, 1] },
      { week: '2026-11-09', people: 1, active: [1] },
    ])
  })

  it('counts a funnel inside its window', async () => {
    const all = { ...scope, from: at(-1), to: at(14) }
    const steps = ['signed_up', 'cart_item_added', 'purchase_completed']
    expect(await funnelSteps(client, all, steps, 7)).toEqual([3, 3, 2])
    expect(await funnelSteps(client, all, steps, 1)).toEqual([3, 3, 1])
  })

  it('reads when a key event last came and its normal at this hour', async () => {
    const [rate] = await keyEventRates(
      client,
      [{ orgId: org, projectId: project, event: 'purchase_completed' }],
      at(8, 20),
    )
    expect(rate?.last?.toISOString()).toBe(at(8, 2).toISOString())
    // Once within half an hour of 12:20 on the 7 days before (Nov 5), none on the others.
    expect(rate?.normal).toBeCloseTo(1 / 7)
    const [none] = await keyEventRates(
      client,
      [{ orgId: org, projectId: project, event: 'never_sent' }],
      at(8),
    )
    expect(none).toMatchObject({ last: null, normal: 0 })
    expect(await lastUsageEvent(client, org, project, NO_SOURCE)).toBeNull()
  })
})
