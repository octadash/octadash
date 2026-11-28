import { describe, expect, it } from 'vitest'
import { parseTvSettings, TV_DEFAULTS, tvHref, tvPages } from './tv'

describe('TV settings', () => {
  it('reads the address and falls back to the defaults', () => {
    expect(parseTvSettings({})).toEqual(TV_DEFAULTS)
    expect(
      parseTvSettings({ scope: 'g:main', m: 'responseMs,nope,visitorsNow', per: '6', sound: '1' }),
    ).toEqual({ scope: 'g:main', metrics: ['responseMs', 'visitorsNow'], perPage: 6, sound: true })
    expect(parseTvSettings({ scope: 'x:../../', per: '100' })).toMatchObject({
      scope: 'all',
      perPage: 9,
    })
    expect(
      parseTvSettings({
        metrics: ['visitorsNow', 'pageviewsToday', 'eventsToday', 'responseMs'],
      }).metrics,
    ).toHaveLength(3)
    const href = tvHref({ ...TV_DEFAULTS, scope: 'p:shop', sound: true })
    const params = Object.fromEntries(new URL(href, 'http://x').searchParams)
    expect(parseTvSettings(params)).toEqual({ ...TV_DEFAULTS, scope: 'p:shop', sound: true })
  })

  it('pins products with something going on to every page', () => {
    const tiles = [
      { id: 'down', pinned: true },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, pinned: false })),
    ]
    const pages = tvPages(tiles, 6)
    expect(pages).toHaveLength(2)
    expect(pages.every((page) => page[0]?.id === 'down')).toBe(true)
    expect(pages.flat().filter((t) => !t.pinned)).toHaveLength(10)
    expect(tvPages([{ id: 'a', pinned: false }], 9)).toEqual([[{ id: 'a', pinned: false }]])
    expect(tvPages([], 9)).toEqual([[]])
  })
})
