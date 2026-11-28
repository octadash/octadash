import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from './client'
import {
  costDayTotals,
  fixedCostDays,
  listCostDays,
  listCostHours,
  listCostShares,
  listCostSplitHistory,
  recordCostSplit,
  saveCostDays,
  saveCostHours,
  setConnectionSplit,
  setCostShare,
  splitOn,
} from './costs'
import { migrateToLatest } from './migrate'
import { createConnection } from './money'

describe('fixedCostDays', () => {
  it('divides a monthly bill by the days of each month and starts on its day', () => {
    const days = fixedCostDays(
      { amount: 3000, every: 'month', startsOn: '2026-11-29' },
      '2026-11-28',
      '2026-12-01',
    )
    expect(days).toEqual([
      { day: '2026-11-29', amount: 100 },
      { day: '2026-11-30', amount: 100 },
      { day: '2026-12-01', amount: 3000 / 31 },
    ])
    const year = fixedCostDays(
      { amount: 36500, every: 'year', startsOn: '2026-01-01' },
      '2026-03-01',
      '2026-03-01',
    )
    expect(year).toEqual([{ day: '2026-03-01', amount: 100 }])
  })
})

describe('splitOn', () => {
  const versions = [{ validFrom: '2026-10-01' }, { validFrom: '2026-12-01' }]
  it('takes the last version from that day or before', () => {
    expect(splitOn(versions, '2026-11-15')?.validFrom).toBe('2026-10-01')
    expect(splitOn(versions, '2026-12-01')?.validFrom).toBe('2026-12-01')
    expect(splitOn(versions, '2027-01-01')?.validFrom).toBe('2026-12-01')
  })
  it('uses the first version for days before it', () => {
    expect(splitOn(versions, '2026-09-01')?.validFrom).toBe('2026-10-01')
    expect(splitOn([], '2026-09-01')).toBeUndefined()
  })
})

const url = process.env.DATABASE_URL
describe.skipIf(!url)('costs in Postgres', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })
  const orgId = randomUUID()
  const connectionId = randomUUID()
  const projectId = randomUUID()

  beforeAll(async () => {
    await migrateToLatest(db)
    await createConnection(db, orgId, connectionId, {
      integration: 'openai',
      name: 'OpenAI',
      secrets: '{}',
      keyHint: 'h2Pw',
      webhookToken: randomUUID().replaceAll('-', ''),
    })
  })
  afterAll(async () => {
    await db.deleteFrom('connection').where('id', '=', connectionId).execute()
    await pool.end()
  })

  it('keeps shares with tags, rest and percent', async () => {
    await setCostShare(db, orgId, connectionId, projectId, {
      tags: ['proj_a', ' proj_a '],
      rest: true,
      percent: 140,
    })
    expect(await listCostShares(db, orgId)).toEqual([
      { connectionId, projectId, tags: ['proj_a'], rest: true, percent: 100 },
    ])
  })

  it('replaces re-read days, so rows that went away go', async () => {
    await saveCostDays(
      db,
      orgId,
      connectionId,
      ['2026-11-27', '2026-11-28'],
      [
        { day: '2026-11-27', tag: 'proj_a', lineItem: 'gpt', amount: 10.5, currency: 'USD' },
        { day: '2026-11-28', tag: 'proj_a', lineItem: 'gpt', amount: 1, currency: 'USD' },
        { day: '2026-11-28', tag: 'proj_b', lineItem: 'gpt', amount: 2, currency: 'USD' },
      ],
    )
    await saveCostDays(
      db,
      orgId,
      connectionId,
      ['2026-11-28'],
      [{ day: '2026-11-28', tag: 'proj_a', lineItem: 'gpt', amount: 4, currency: 'USD' }],
    )
    expect(await costDayTotals(db, connectionId, '2026-11-28')).toEqual(new Map([['proj_a', 4]]))
    const rows = await listCostDays(db, orgId, '2026-11-01', '2026-11-30')
    expect(rows.map((r) => [r.day, r.tag, r.amount]).sort()).toEqual([
      ['2026-11-27', 'proj_a', 10.5],
      ['2026-11-28', 'proj_a', 4],
    ])
  })

  it('sets provider hours and adds growth between reads', async () => {
    const hour = new Date('2026-11-28T10:00:00Z')
    await saveCostHours(
      db,
      orgId,
      connectionId,
      [{ hour, tag: 'proj_a', amount: 3, currency: 'USD' }],
      'add',
    )
    await saveCostHours(
      db,
      orgId,
      connectionId,
      [{ hour, tag: 'proj_a', amount: 2, currency: 'USD' }],
      'add',
    )
    expect((await listCostHours(db, orgId, hour))[0]?.amount).toBe(5)
    await saveCostHours(
      db,
      orgId,
      connectionId,
      [{ hour, tag: 'proj_a', amount: 7, currency: 'USD' }],
      'set',
    )
    expect((await listCostHours(db, orgId, hour))[0]?.amount).toBe(7)
  })

  it('keeps the division from the day it changed, one version a day', async () => {
    const other = randomUUID()
    await setCostShare(db, orgId, connectionId, other, { tags: [], rest: true, percent: null })
    await recordCostSplit(db, orgId, connectionId, '2026-10-01')
    await setConnectionSplit(db, orgId, connectionId, 'percent')
    await setCostShare(db, orgId, connectionId, other, { tags: [], rest: true, percent: 20 })
    await recordCostSplit(db, orgId, connectionId, '2026-12-01')
    await setCostShare(db, orgId, connectionId, other, { tags: [], rest: true, percent: 30 })
    await recordCostSplit(db, orgId, connectionId, '2026-12-01')
    const history = await listCostSplitHistory(db, orgId)
    expect(history.map((v) => [v.validFrom, v.split])).toEqual([
      ['2026-10-01', 'equal'],
      ['2026-12-01', 'percent'],
    ])
    expect(history[0]?.shares.find((s) => s.projectId === other)?.percent).toBeNull()
    expect(history[1]?.shares.find((s) => s.projectId === other)?.percent).toBe(30)
    expect(history[1]?.shares).toHaveLength(2)
    await recordCostSplit(db, orgId, connectionId)
    expect((await listCostSplitHistory(db, orgId)).length).toBe(3)
  })
})
