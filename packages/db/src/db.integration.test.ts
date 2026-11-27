import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { migrateToLatest } from './migrate'
import { dropExpiredPartitions, ensureDailyPartitions } from './partitions'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('database (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2, applicationName: 'octadash-test' })

  beforeAll(async () => {
    await sql`drop table if exists test_events cascade`.execute(db)
    await sql`create table test_events (
      project_id uuid not null,
      ts timestamptz not null
    ) partition by range (ts)`.execute(db)
  })

  afterAll(async () => {
    await sql`drop table if exists test_events cascade`.execute(db)
    await pool.end()
  })

  it('applies migrations and is idempotent', async () => {
    const first = await migrateToLatest(db)
    expect(first.error).toBeUndefined()
    const second = await migrateToLatest(db)
    expect(second.error).toBeUndefined()
    expect(second.results).toEqual([])
    const rows = await db.selectFrom('octadash_instance').select('id').execute()
    expect(rows).toHaveLength(1)
  })

  it('creates and drops daily partitions', async () => {
    const today = new Date('2026-11-27T10:00:00Z')
    await ensureDailyPartitions(db, 'test_events', {
      today: new Date('2026-11-20T00:00:00Z'),
      daysAhead: 0,
    })
    const created = await ensureDailyPartitions(db, 'test_events', { today, daysAhead: 2 })
    expect(created).toEqual([
      'test_events_p20261127',
      'test_events_p20261128',
      'test_events_p20261129',
    ])

    await sql`insert into test_events values (gen_random_uuid(), '2026-11-28T12:00:00Z')`.execute(
      db,
    )

    const dropped = await dropExpiredPartitions(db, 'test_events', 3, today)
    expect(dropped).toEqual(['test_events_p20261120'])
  })
})
