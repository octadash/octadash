import { describe, expect, it } from 'vitest'
import { normalOf, normalWindows, parseSteps, parseUsageState, usageHref } from './usage'
import { tabOf, usageSnippet } from './usage-setup'

describe('usage page state', () => {
  it('reads the address and keeps defaults out of links', () => {
    const state = parseUsageState({ period: '30d', metric: 'nope', q: '  pay ', show: '999' })
    expect(state).toEqual({ period: '30d', metric: 'active', q: 'pay', show: 200, source: null })
    expect(usageHref('/all/usage', state, { period: '7d', q: '', show: 25 })).toBe('/all/usage')
    expect(usageHref('/all/usage', state, { metric: 'signups' })).toBe(
      '/all/usage?period=30d&metric=signups&q=pay&show=200',
    )
    expect(parseUsageState({ show: '-1' }).show).toBe(25)
  })
})

describe('normal for an event', () => {
  it('compares against the same stretch in earlier weeks', () => {
    const from = new Date('2026-11-20T00:00:00Z')
    const to = new Date('2026-11-27T00:00:00Z')
    const windows = normalWindows({ from, to })
    expect(windows).toHaveLength(4)
    expect(windows[0]?.from.toISOString()).toBe('2026-11-13T00:00:00.000Z')
    expect(windows[3]?.to.toISOString()).toBe('2026-10-30T00:00:00.000Z')
    // A 30-day period steps back in whole weeks, never overlapping itself.
    const month = normalWindows({ from: new Date(to.getTime() - 30 * 86_400_000), to })
    expect(to.getTime() - (month[0]?.to.getTime() ?? 0)).toBe(35 * 86_400_000)
  })

  it('says below, above, new, few and stopped', () => {
    expect(normalOf(50, [100, 100]).status).toBe('below')
    expect(normalOf(50, [100, 100]).percent).toBe(50)
    expect(normalOf(200, [100, 100]).status).toBe('above')
    expect(normalOf(110, [100, 100]).status).toBe('expected')
    expect(normalOf(3, []).status).toBe('new')
    expect(normalOf(0, []).status).toBe('few')
    expect(normalOf(1, [2, 3]).status).toBe('few')
    expect(normalOf(120, [100], true).status).toBe('stopped')
  })
})

describe('funnel steps', () => {
  it('reads one per line or comma, without blanks, at most 8', () => {
    expect(parseSteps(' a \n\nb, c ')).toEqual(['a', 'b', 'c'])
    expect(parseSteps('1,2,3,4,5,6,7,8,9,10')).toHaveLength(8)
  })
})

describe('Set up Product usage code', () => {
  it('picks the tab for a platform and fills the key', () => {
    expect(tabOf('nextjs')).toBe('browser')
    expect(tabOf('python')).toBe('python')
    const snippet = usageSnippet('posthog', {
      ingestUrl: 'https://in.example.com',
      publicKey: 'pk_test',
      hasScript: false,
    })
    expect(snippet.track).toContain('pk_test')
    expect(snippet.track).toContain('https://in.example.com')
  })
})
