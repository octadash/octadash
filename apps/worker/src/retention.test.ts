import { describe, expect, it } from 'vitest'
import { cachedRetention } from './retention'

describe('cachedRetention', () => {
  it('reads each product once a minute and falls back to the default', async () => {
    let at = 0
    const asked: string[][] = []
    const retentionOf = cachedRetention(
      async (ids) => {
        asked.push(ids)
        return new Map([['p1', 30]])
      },
      90,
      () => at,
    )
    expect([...(await retentionOf(['p1', 'p2', 'p1']))]).toEqual([
      ['p1', 30],
      ['p2', 90],
    ])
    at = 30_000
    await retentionOf(['p1'])
    expect(asked).toEqual([['p1', 'p2']])
    at = 61_000
    await retentionOf(['p1'])
    expect(asked).toEqual([['p1', 'p2'], ['p1']])
  })
})
