import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deletePrefix, fileKey, type S3FileStore, storageFromEnv } from './store'

/**
 * Against a real S3-compatible store: the dev compose's Garage in CI
 * (`docker compose -f docker-compose.dev.yml up -d garage`). Skipped when
 * STORAGE_ENDPOINT is not set.
 */
const store = storageFromEnv({
  STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT,
  STORAGE_BUCKET: process.env.STORAGE_BUCKET ?? 'octadash',
  STORAGE_REGION: process.env.STORAGE_REGION ?? 'garage',
  STORAGE_ACCESS_KEY_ID: process.env.STORAGE_ACCESS_KEY_ID,
  STORAGE_SECRET_ACCESS_KEY: process.env.STORAGE_SECRET_ACCESS_KEY,
})
const run = `test-${randomUUID()}`

describe.skipIf(!store)('S3FileStore', () => {
  const files = store as S3FileStore

  beforeAll(async () => {
    // Garage makes its key and bucket a moment after it starts answering.
    for (let i = 0; ; i++) {
      try {
        await files.check()
        return
      } catch (err) {
        if (i >= 30) throw err
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  }, 40_000)

  afterAll(async () => {
    await deletePrefix(files, `${run}/`)
  })

  it('writes, reads, lists and removes files', async () => {
    const day = new Date('2026-11-28T10:00:00Z')
    const key = `${run}/${fileKey(day, 'org', 'project', 'sentry.attachment', 'a b+c')}`
    const body = new Uint8Array([0, 1, 2, 255, 254])
    await files.put(key, body, 'application/octet-stream')
    expect(await files.get(key)).toEqual(body)
    await files.put(`${run}/files/2026-11-29/x`, new TextEncoder().encode('hi'), 'text/plain')

    expect(await files.folders(`${run}/files/`)).toEqual([
      `${run}/files/2026-11-28/`,
      `${run}/files/2026-11-29/`,
    ])
    const listed = await files.list(`${run}/files/2026-11-28/`)
    expect(listed.files).toEqual([{ key, size: body.length }])

    expect(await deletePrefix(files, `${run}/files/2026-11-28/`)).toEqual({ count: 1, bytes: 5 })
    expect(await files.get(key)).toBeNull()
    expect((await files.list(`${run}/`)).files.map((f) => f.key)).toEqual([
      `${run}/files/2026-11-29/x`,
    ])
  })

  it('pages through long listings and deletes in batches', async () => {
    const prefix = `${run}/many/`
    await Promise.all(
      Array.from({ length: 1005 }, (_, i) =>
        files.put(`${prefix}${String(i).padStart(4, '0')}`, new Uint8Array([1]), 'text/plain'),
      ),
    )
    const first = await files.list(prefix)
    expect(first.next).toBeDefined()
    const second = await files.list(prefix, first.next)
    expect(first.files.length + second.files.length).toBe(1005)
    expect(await deletePrefix(files, prefix)).toEqual({ count: 1005, bytes: 1005 })
  }, 60_000)
})
