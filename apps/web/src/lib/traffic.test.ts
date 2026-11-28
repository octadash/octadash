import { describe, expect, it } from 'vitest'
import {
  flagOf,
  parseFilters,
  shareOf,
  startOfDay,
  trafficHref,
  trafficPeriod,
  withFilters,
} from './traffic'

describe('traffic page', () => {
  it('starts today at local midnight and compares with yesterday until the same hour', () => {
    const now = new Date('2026-11-28T15:30:00Z')
    expect(startOfDay(now, 'America/Sao_Paulo').toISOString()).toBe('2026-11-28T03:00:00.000Z')
    const today = trafficPeriod('today', now, 'America/Sao_Paulo')
    expect(today.from.toISOString()).toBe('2026-11-28T03:00:00.000Z')
    expect(today.previous.from.toISOString()).toBe('2026-11-27T03:00:00.000Z')
    expect(today.previous.to.toISOString()).toBe('2026-11-27T15:30:00.000Z')
    expect(trafficPeriod('30d', now, 'UTC').bucket).toBe('day')
    expect(trafficPeriod('7d', now, 'UTC').previous.to).toEqual(
      trafficPeriod('7d', now, 'UTC').from,
    )
  })

  it('reads filters from the address, one per dimension, unknown ones dropped', () => {
    expect(
      parseFilters(['source:google.com', 'country:BR', 'source:bing.com', 'nope:x', 'page:/a:b']),
    ).toEqual([
      { dimension: 'source', value: 'google.com' },
      { dimension: 'country', value: 'BR' },
      { dimension: 'page', value: '/a:b' },
    ])
    expect(parseFilters('source:')).toEqual([{ dimension: 'source', value: '' }])
    expect(parseFilters(undefined)).toEqual([])
  })

  it('builds the address with one change', () => {
    const state = { period: '30d' as const, metric: 'visitors' as const, filters: [] }
    expect(trafficHref('/all/traffic', state, {})).toBe('/all/traffic')
    expect(
      trafficHref('/all/traffic', state, {
        period: '7d',
        filters: [{ dimension: 'source', value: 'google.com' }],
      }),
    ).toBe('/all/traffic?period=7d&f=source%3Agoogle.com')
    expect(
      withFilters(
        [{ dimension: 'page', value: '/' }],
        [
          { dimension: 'product', value: 'p1' },
          { dimension: 'page', value: '/blog' },
        ],
      ),
    ).toEqual([
      { dimension: 'product', value: 'p1' },
      { dimension: 'page', value: '/blog' },
    ])
  })

  it('draws flags and shares', () => {
    expect(flagOf('BR')).toBe('🇧🇷')
    expect(flagOf('')).toBe('')
    expect(shareOf(1, 1000)).toBe(1)
    expect(shareOf(0, 10)).toBe(0)
    expect(shareOf(46, 100)).toBe(46)
  })
})
