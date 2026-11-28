import type { StorageStatus } from '@octadash/queue'
import { describe, expect, it } from 'vitest'
import { isBundled, storageState } from './storage'

const now = Date.parse('2026-11-28T12:00:00Z')
const status = (over: Partial<StorageStatus> = {}): StorageStatus => ({
  checkedAt: '2026-11-28T11:41:00Z',
  configured: true,
  ok: true,
  error: null,
  host: 'garage:3900',
  usedBytes: 1e9,
  limitBytes: 20e9,
  retentionDays: 30,
  trimmed: null,
  ...over,
})

describe('storageState', () => {
  it('reads the worker status', () => {
    expect(storageState(null, now)).toBe('unknown')
    expect(storageState(status({ configured: false }), now)).toBe('off')
    expect(storageState(status({ ok: false, error: 'timeout' }), now)).toBe('failing')
    expect(storageState(status({ usedBytes: 18e9 }), now)).toBe('full')
    expect(storageState(status({ usedBytes: 18e9, limitBytes: 0 }), now)).toBe('ok')
    expect(
      storageState(
        status({ trimmed: { day: '2026-10-30', at: '2026-11-27T11:41:00Z', files: 4 } }),
        now,
      ),
    ).toBe('trimmed')
    expect(
      storageState(
        status({ trimmed: { day: '2026-10-01', at: '2026-11-01T11:41:00Z', files: 4 } }),
        now,
      ),
    ).toBe('ok')
    expect(storageState(status(), now)).toBe('ok')
  })

  it('knows the bundled store by its address', () => {
    expect(isBundled('garage:3900')).toBe(true)
    expect(isBundled('abc.r2.cloudflarestorage.com')).toBe(false)
    expect(isBundled(null)).toBe(false)
  })
})
