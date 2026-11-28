import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClickHouse } from './clickhouse/client'
import { toClickHouseTime } from './clickhouse/events'
import { migrateClickHouse } from './clickhouse/migrate'
import {
  insertPayments,
  insertSubscriptions,
  knownEnds,
  latestPayments,
  mrrAt,
  type PaymentRow,
  paymentDays,
  paymentRates,
  type SubscriptionRow,
  subscriptionChanges,
} from './clickhouse/money'
import { createDb } from './client'
import { migrateToLatest } from './migrate'
import {
  connectionByToken,
  convertMinor,
  createConnection,
  deleteConnection,
  fxRates,
  latestFxDay,
  listConnectionProjects,
  removeConnectionProject,
  saveFxRates,
  setConnectionProject,
} from './money'
import { createProject } from './projects'

const url = process.env.DATABASE_URL
const chUrl = process.env.CLICKHOUSE_URL
const org = '00000000-0000-4000-8000-0000000005a1'

describe('convertMinor', () => {
  const rates = new Map([
    [
      '2026-11-26',
      new Map([
        ['BRL', 5.4],
        ['EUR', 0.9],
      ]),
    ],
    ['2026-11-28', new Map([['BRL', 5.5]])],
  ])
  it('converts at the day or the last day before it', () => {
    expect(convertMinor(1000, 'USD', 'BRL', '2026-11-28', rates)).toBe(5500)
    expect(convertMinor(5400, 'BRL', 'USD', '2026-11-27', rates)).toBe(1000)
    expect(convertMinor(900, 'EUR', 'BRL', '2026-11-28', rates)).toBe(5500)
    expect(convertMinor(100, 'USD', 'JPY', '2026-11-28', rates)).toBeNull()
    // Before the first rate: the first one there is.
    expect(convertMinor(1000, 'USD', 'BRL', '2026-01-01', rates)).toBe(5400)
  })
})

describe.skipIf(!url)('connections and rates (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })
  let shop = ''
  let pay = ''

  beforeAll(async () => {
    await migrateToLatest(db)
    await db.deleteFrom('connection').where('org_id', '=', org).execute()
    await db.deleteFrom('project').where('org_id', '=', org).execute()
    shop = (await createProject(db, org, { name: 'Money Shop' })).id
    pay = (await createProject(db, org, { name: 'Money Pay' })).id
  })
  afterAll(async () => {
    await db.deleteFrom('connection').where('org_id', '=', org).execute()
    await db.deleteFrom('project').where('org_id', '=', org).execute()
    await db.deleteFrom('fx_rate').where('day', '<', '2000-01-10').execute()
    await pool.end()
  })

  it('keeps a connection, its products and finds it by its webhook token', async () => {
    const id = randomUUID()
    const token = randomUUID().replaceAll('-', '')
    await createConnection(db, org, id, {
      integration: 'stripe',
      name: 'Stripe',
      secrets: 'v1.x',
      keyHint: '3kQ9',
      webhookToken: token,
    })
    await setConnectionProject(db, org, id, shop, { mode: 'all' })
    await setConnectionProject(db, org, id, pay, {
      mode: 'metadata',
      values: ['acme-pay', ' acme-pay'],
    })
    expect((await connectionByToken(db, 'stripe', token))?.id).toBe(id)
    expect(await connectionByToken(db, 'asaas', token)).toBeUndefined()
    const projects = await listConnectionProjects(db, org)
    expect(projects.find((p) => p.projectId === pay)?.rule).toEqual({
      mode: 'metadata',
      values: ['acme-pay'],
    })
    await removeConnectionProject(db, org, id, pay)
    expect(await listConnectionProjects(db, org)).toHaveLength(1)
    expect(await deleteConnection(db, org, id)).toBe(true)
    expect(await listConnectionProjects(db, org)).toHaveLength(0)
  })

  it('saves rates and reads the day before a period too', async () => {
    await saveFxRates(db, [
      { day: '2000-01-01', currency: 'BRL', perUsd: 1.8 },
      { day: '2000-01-03', currency: 'BRL', perUsd: 1.9 },
      { day: '2000-01-03', currency: 'EUR', perUsd: 1.0 },
    ])
    await saveFxRates(db, [{ day: '2000-01-03', currency: 'BRL', perUsd: 1.85 }])
    const rates = await fxRates(db, '2000-01-02', '2000-01-05')
    expect([...rates.keys()]).toEqual(['2000-01-01', '2000-01-03'])
    expect(rates.get('2000-01-03')?.get('BRL')).toBe(1.85)
    expect(await latestFxDay(db)).not.toBeNull()
  })
})

describe.skipIf(!chUrl)('money queries (needs CLICKHOUSE_URL)', () => {
  const client = createClickHouse(chUrl ?? '')
  const project = randomUUID()
  const other = randomUUID()
  const connection = randomUUID()
  const T0 = new Date('2026-11-28T12:00:00Z')
  const at = (minutes: number) => toClickHouseTime(new Date(T0.getTime() + minutes * 60_000))
  const payment = (
    id: string,
    minutes: number,
    status: string,
    amount: number,
    currency = 'USD',
  ): PaymentRow => ({
    org_id: org,
    project_id: project,
    connection_id: connection,
    gateway: 'stripe',
    id,
    status,
    amount,
    refunded: status === 'refunded' ? amount : 0,
    fee: 30,
    currency,
    method: 'card',
    customer: 'c',
    subscription_id: '',
    at: at(minutes),
    failure: status === 'failed' ? 'card_declined' : '',
    updated_at: at(minutes),
  })
  const subscription = (
    id: string,
    started: number,
    ended: number | null,
    mrr: number,
    status = ended === null ? 'active' : 'canceled',
  ): SubscriptionRow => ({
    org_id: org,
    project_id: project,
    connection_id: connection,
    gateway: 'stripe',
    id,
    status,
    mrr,
    currency: 'USD',
    customer: `cus_${id}`,
    started_at: at(started * 1440),
    canceled_at: ended === null ? null : at(ended * 1440),
    updated_at: at(0),
  })

  beforeAll(async () => {
    await migrateClickHouse(chUrl ?? '')
    await insertPayments(client, [
      payment('ch_1', -30, 'paid', 1000),
      payment('ch_2', -20, 'failed', 1000),
      payment('ch_3', -10, 'paid', 2000, 'BRL'),
      payment('ch_4', -1500, 'paid', 500),
    ])
    // ch_1 refunded later: the newer row replaces it.
    await insertPayments(client, [{ ...payment('ch_1', -30, 'refunded', 1000), updated_at: at(5) }])
    // A payment moved to another product counts there only.
    await insertPayments(client, [
      { ...payment('ch_4', -1500, 'paid', 500), project_id: other, updated_at: at(6) },
    ])
    await insertSubscriptions(client, [
      subscription('s1', -60, null, 2900),
      subscription('s2', -40, -5, 1000),
      subscription('s3', -2, null, 5000),
      subscription('s4', -1, null, 9900, 'trialing'),
    ])
  })
  afterAll(async () => {
    await client.command({ query: `ALTER TABLE payments DELETE WHERE org_id = '${org}'` })
    await client.command({ query: `ALTER TABLE subscriptions DELETE WHERE org_id = '${org}'` })
    await client.close()
  })

  const scope = {
    orgId: org,
    projectIds: [project],
    from: new Date(T0.getTime() - 86_400_000),
    to: T0,
  }

  it('sums payments per local day and currency, keeping the newest version', async () => {
    const days = await paymentDays(client, scope, 'America/Sao_Paulo')
    const usd = days.find((d) => d.currency === 'USD')
    expect(usd).toMatchObject({
      day: '2026-11-28',
      paid: 1000,
      refunded: 1000,
      paidCount: 1,
      failedCount: 1,
    })
    expect(days.find((d) => d.currency === 'BRL')?.paid).toBe(2000)
    expect(days.some((d) => d.paid === 500)).toBe(false)
  })

  it('reads MRR at each moment without trials', async () => {
    const points = await mrrAt(
      client,
      org,
      [project],
      [new Date(T0.getTime() - 30 * 86_400_000), T0],
    )
    expect(points.map((p) => p.mrr)).toEqual([2900 + 1000, 2900 + 5000])
    expect(points[1]?.customers).toBe(2)
  })

  it('counts new and ended subscriptions', async () => {
    const changes = await subscriptionChanges(client, {
      ...scope,
      from: new Date(T0.getTime() - 30 * 86_400_000),
    })
    expect(changes[0]).toMatchObject({ atStart: 2, started: 1, ended: 1 })
  })

  it('gives the failure rate and the newest payments', async () => {
    const rates = await paymentRates(client, new Date(T0.getTime() - 60 * 60_000), {
      orgId: org,
      projectIds: [project],
    })
    expect(rates[0]).toMatchObject({ paid: 2, failed: 1 })
    const latest = await latestPayments(client, org, [project], 2)
    expect(latest.map((p) => p.id)).toEqual(['ch_3', 'ch_2'])
  })

  it('remembers when a subscription was first seen ended', async () => {
    const ends = await knownEnds(client, org, connection, ['s1', 's2'])
    expect([...ends.keys()]).toEqual(['s2'])
  })
})
