import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { migrateToLatest } from './migrate'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('database (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2, applicationName: 'octadash-test' })

  afterAll(async () => {
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
})
