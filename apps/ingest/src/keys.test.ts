import { describe, expect, it, vi } from 'vitest'
import { cachedHeartbeatResolver, cachedResolver } from './keys'

const KEY = 'c'.repeat(32)
const scope = { org_id: 'o', project_id: 'p' }

describe('cachedResolver', () => {
  it('asks Postgres once per key while the answer is fresh', async () => {
    let now = 0
    const lookup = vi.fn(async () => scope)
    const keys = cachedResolver(lookup, { ttlMs: 1_000, now: () => now })
    await Promise.all([keys.resolve(KEY), keys.resolve(KEY)])
    expect(await keys.resolve(KEY)).toEqual(scope)
    expect(lookup).toHaveBeenCalledTimes(1)
    now = 1_001
    await keys.resolve(KEY)
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('remembers unknown keys and never looks up malformed ones', async () => {
    const lookup = vi.fn(async () => undefined)
    const keys = cachedResolver(lookup)
    expect(await keys.resolve(KEY)).toBeNull()
    expect(await keys.resolve(KEY)).toBeNull()
    expect(await keys.resolve('drop table')).toBeNull()
    expect(lookup).toHaveBeenCalledTimes(1)
  })
})

describe('cachedHeartbeatResolver', () => {
  it('skips malformed tokens and caches the monitor id', async () => {
    const lookup = vi.fn(async (token: string) =>
      token === 'a'.repeat(32) ? { id: 'm1' } : undefined,
    )
    const resolver = cachedHeartbeatResolver(lookup)
    expect(await resolver.resolve('short')).toBeNull()
    expect(await resolver.resolve('a'.repeat(32))).toBe('m1')
    expect(await resolver.resolve('a'.repeat(32))).toBe('m1')
    expect(lookup).toHaveBeenCalledTimes(1)
  })
})
