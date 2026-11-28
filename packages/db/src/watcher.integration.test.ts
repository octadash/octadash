import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { migrateToLatest } from './migrate'
import { getWatcher, recordWatcherPing, setWatcherUrl } from './watcher'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('outside watcher (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })
  beforeAll(() => migrateToLatest(db))
  afterAll(async () => {
    await setWatcherUrl(db, null)
    await pool.end()
  })

  it('keeps one URL per install and its last result', async () => {
    await setWatcherUrl(db, null)
    // Without a URL, a stray ping result is not kept.
    await recordWatcherPing(db, 'ok', null, new Date())
    expect(await getWatcher(db)).toMatchObject({ watcher_url: null, watcher_status: 'unknown' })

    await setWatcherUrl(db, 'v1.encrypted')
    const at = new Date('2026-11-28T12:00:00Z')
    await recordWatcherPing(db, 'failing', 'HTTP 404', at)
    expect(await getWatcher(db)).toMatchObject({
      watcher_url: 'v1.encrypted',
      watcher_status: 'failing',
      watcher_error: 'HTTP 404',
      watcher_checked_at: at,
    })

    // A new URL starts over.
    await setWatcherUrl(db, 'v1.other')
    expect(await getWatcher(db)).toMatchObject({
      watcher_status: 'unknown',
      watcher_checked_at: null,
    })
  })
})
