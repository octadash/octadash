import { describe, expect, it } from 'vitest'
import {
  controlsSeen,
  filterItems,
  type StripItem,
  sortItems,
  stripSummary,
  takerLine,
  visibleItems,
  visibleResolved,
} from './emergency-strip'

const T = Date.parse('2026-11-28T06:00:00Z')
const min = 60_000

function item(id: string, over: Partial<StripItem> = {}): StripItem {
  return {
    id,
    href: `/p/x/emergencies/${id}`,
    projectId: `p-${id}`,
    product: `Product ${id}`,
    kind: 'monitor_down',
    title: `Product ${id} is down`,
    short: `Product ${id} down`,
    detail: '',
    startedAt: T,
    showAt: T,
    taker: null,
    ip: null,
    controls: [],
    ...over,
  }
}

describe('emergency strip', () => {
  it('shows an emergency only once its rule has waited', () => {
    const items = [item('a'), item('b', { showAt: T + 2 * min })]
    expect(visibleItems(items, T + min).map((i) => i.id)).toEqual(['a'])
    expect(visibleItems(items, T + 2 * min).map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('keeps an ended one green for ten seconds', () => {
    const resolved = [
      { id: 'a', href: '', title: '', lastedMs: 0, taker: null, resolvedAt: T },
      { id: 'b', href: '', title: '', lastedMs: 0, taker: null, resolvedAt: T + 5000 },
    ]
    expect(visibleResolved(resolved, T + 6000).map((r) => r.id)).toEqual(['b', 'a'])
    expect(visibleResolved(resolved, T + 12_000).map((r) => r.id)).toEqual(['b'])
    expect(visibleResolved(resolved, T + 20_000)).toEqual([])
  })

  it('lists nobody-on-it first, then the oldest', () => {
    const items = [
      item('taken-old', { startedAt: T - 9 * min, taker: { id: 'u1', name: 'Ana', at: T } }),
      item('new', { startedAt: T }),
      item('old', { startedAt: T - 5 * min }),
    ]
    expect(sortItems(items).map((i) => i.id)).toEqual(['old', 'new', 'taken-old'])
    expect(sortItems(items, 'oldest').map((i) => i.id)).toEqual(['taken-old', 'old', 'new'])
    expect(sortItems(items, 'newest').map((i) => i.id)).toEqual(['new', 'old', 'taken-old'])
    expect(filterItems(items, 'nobody', 'u1').map((i) => i.id)).toEqual(['new', 'old'])
    expect(filterItems(items, 'mine', 'u1').map((i) => i.id)).toEqual(['taken-old'])
  })

  it('says who is on what', () => {
    const ana = { id: 'u1', name: 'Ana', at: T }
    const bia = { id: 'u2', name: 'Bia', at: T }
    expect(takerLine([item('a')], 'u1')).toEqual({ kind: 'nobody' })
    expect(takerLine([item('a', { taker: ana }), item('b')], 'u2')).toEqual({
      kind: 'one',
      name: 'Ana',
      count: 1,
    })
    expect(takerLine([item('a', { taker: ana })], 'u1')).toEqual({ kind: 'you', count: 1 })
    expect(takerLine([item('a', { taker: ana }), item('b', { taker: bia })], 'u1')).toEqual({
      kind: 'several',
      count: 2,
    })
  })

  it('counts many at once and hints the server they share, without merging', () => {
    const items = [
      ...Array.from({ length: 10 }, (_, n) =>
        item(`s${n}`, { ip: '203.0.113.7', startedAt: T + n * 5000 }),
      ),
      item('other', { ip: '198.51.100.1', startedAt: T + 30_000 }),
      item('hb', { kind: 'heartbeat_missed', ip: '203.0.113.7', startedAt: T - 40 * min }),
    ]
    const summary = stripSummary(items)
    expect(summary).toMatchObject({ count: 12, products: 12, togetherMinutes: null })
    expect(summary.shared).toMatchObject({ ip: '203.0.113.7', products: 10 })
    expect(summary.shared?.ids).toHaveLength(10)
    expect(summary.oldestAt).toBe(T - 40 * min)
    expect(stripSummary(items.slice(0, 11)).togetherMinutes).toBe(1)
  })

  it('needs two products on one address for the hint', () => {
    const sameProduct = [
      item('a', { ip: '203.0.113.7', projectId: 'p' }),
      item('b', { ip: '203.0.113.7', projectId: 'p' }),
    ]
    expect(stripSummary(sameProduct).shared).toBeNull()
  })

  it('tells whether this install reached the control addresses', () => {
    const items = [
      item('a', {
        controls: [
          { target: '1.1.1.1', ok: true },
          { target: 'google.com', ok: false },
        ],
      }),
      item('b', { controls: [{ target: 'google.com', ok: true }] }),
    ]
    expect(controlsSeen(items)).toEqual({ reached: ['1.1.1.1', 'google.com'], failed: [] })
  })
})
