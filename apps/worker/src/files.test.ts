import { createLogger } from '@octadash/core'
import type { FileUsage, ReceivedRow } from '@octadash/db'
import type { StorageStatus } from '@octadash/queue'
import { MemoryFileStore } from '@octadash/storage'
import { describe, expect, it } from 'vitest'
import { type FileSweepDeps, sweepFiles } from './files'

const now = Date.parse('2026-11-28T12:00:00Z')
const ORG = '00000000-0000-4000-8000-00000000000a'
const P1 = '00000000-0000-4000-8000-0000000000b1'
const P2 = '00000000-0000-4000-8000-0000000000b2'

async function setup(over: Partial<FileSweepDeps> = {}) {
  const store = new MemoryFileStore()
  const put = (key: string, size: number) => store.put(key, new Uint8Array(size), 'x')
  await put(`files/2026-10-01/${ORG}/${P1}/sentry.attachment/a`, 10)
  await put(`files/2026-11-26/${ORG}/${P1}/sentry.attachment/b`, 600)
  await put(`files/2026-11-26/${ORG}/${P2}/sentry.attachment/c`, 400)
  await put(`files/2026-11-27/${ORG}/${P1}/sentry.attachment/d`, 500)
  await put(`files/2026-11-28/${ORG}/${P1}/sentry.attachment/e`, 700)
  const usage: FileUsage[] = [
    { day: '2026-11-26', org_id: ORG, project_id: P1, files: 1, bytes: 600 },
    { day: '2026-11-26', org_id: ORG, project_id: P2, files: 1, bytes: 400 },
    { day: '2026-11-27', org_id: ORG, project_id: P1, files: 1, bytes: 500 },
    { day: '2026-11-28', org_id: ORG, project_id: P1, files: 1, bytes: 700 },
  ]
  const dropped: ReceivedRow[] = []
  const asked: string[][] = []
  const deps: FileSweepDeps = {
    store,
    host: 'garage:3900',
    retentionDays: 30,
    limitBytes: 0,
    usage: async (days) => {
      asked.push(days)
      return usage.filter((row) => days.includes(row.day))
    },
    insertDropped: async (rows) => {
      dropped.push(...rows)
    },
    previous: async () => null,
    now: () => now,
    log: createLogger('test', 'fatal'),
    ...over,
  }
  return { store, deps, dropped, asked }
}

describe('sweepFiles', () => {
  it('removes days past the retention and reports what is left', async () => {
    const { store, deps, dropped, asked } = await setup()
    const status = await sweepFiles(deps)
    expect([...store.files.keys()].some((key) => key.includes('2026-10-01'))).toBe(false)
    expect(asked).toEqual([['2026-11-26', '2026-11-27', '2026-11-28']])
    expect(dropped).toEqual([])
    expect(status).toMatchObject({
      configured: true,
      ok: true,
      error: null,
      usedBytes: 2200,
      limitBytes: 0,
      retentionDays: 30,
      trimmed: null,
    })
  })

  it('past the limit removes the oldest days first, never today, and counts each product', async () => {
    const { store, deps, dropped } = await setup({ limitBytes: 1000 })
    const status = await sweepFiles(deps)
    const days = [...new Set([...store.files.keys()].map((key) => key.slice(6, 16)))]
    // 26th and 27th go; today's 700 bytes stay even though they alone are near the limit.
    expect(days).toEqual(['2026-11-28'])
    expect(status.usedBytes).toBe(700)
    expect(status.trimmed).toMatchObject({ day: '2026-11-27', files: 1 })
    expect(
      dropped.map((row) => [row.kind, row.project_id, row.bytes, JSON.parse(row.payload)]),
    ).toEqual([
      ['dropped:file', P1, 600, { reason: 'storage_limit', count: 1, day: '2026-11-26' }],
      ['dropped:file', P2, 400, { reason: 'storage_limit', count: 1, day: '2026-11-26' }],
      ['dropped:file', P1, 500, { reason: 'storage_limit', count: 1, day: '2026-11-27' }],
    ])
  })

  it('says when storage is not set or not answering, keeping the last known use', async () => {
    const off = await setup({ store: undefined })
    expect(await sweepFiles(off.deps)).toMatchObject({ configured: false, ok: false })

    const previous = { usedBytes: 1234, trimmed: null } as unknown as StorageStatus
    const down = await setup({ previous: async () => previous })
    down.store.failing = true
    expect(await sweepFiles(down.deps)).toMatchObject({
      configured: true,
      ok: false,
      error: 'storage unavailable',
      usedBytes: 1234,
    })
  })
})
