import { describe, expect, it } from 'vitest'
import { dayOfFolder, deletePrefix, fileKey, MemoryFileStore } from './store'

describe('fileKey', () => {
  it('starts with the day, then the organization, product and kind', () => {
    expect(
      fileKey(new Date('2026-11-28T23:59:00Z'), 'org-1', 'prod-1', 'sentry.attachment', 'id/../x'),
    ).toBe('files/2026-11-28/org-1/prod-1/sentry.attachment/id_.._x')
    expect(dayOfFolder('files/2026-11-28/')).toBe('2026-11-28')
    expect(dayOfFolder('files/other/')).toBeUndefined()
  })
})

describe('MemoryFileStore', () => {
  it('lists folders and deletes a prefix', async () => {
    const store = new MemoryFileStore()
    await store.put('files/2026-11-27/a', new Uint8Array(3), 'x')
    await store.put('files/2026-11-28/b', new Uint8Array(2), 'x')
    expect(await store.folders('files/')).toEqual(['files/2026-11-27/', 'files/2026-11-28/'])
    expect(await deletePrefix(store, 'files/2026-11-27/')).toEqual({ count: 1, bytes: 3 })
    expect([...store.files.keys()]).toEqual(['files/2026-11-28/b'])
  })
})
