import { describe, expect, it } from 'vitest'
import { costRunaway } from './alerts'
import { costDays, costHours, costWork, growth } from './costs'

const at = (iso: string) => new Date(iso)

describe('costWork', () => {
  const now = at('2026-11-28T10:00:00Z')
  it('imports first, waits 15 min after a failed import, then reads on its schedule', () => {
    expect(costWork({ status: 'importing', imported_at: null, synced_at: null }, 60, now)).toBe(
      'import',
    )
    expect(
      costWork(
        { status: 'failing', imported_at: null, synced_at: at('2026-11-28T09:50:00Z') },
        60,
        now,
      ),
    ).toBeNull()
    const imported = at('2026-11-27T00:00:00Z')
    expect(
      costWork(
        { status: 'ok', imported_at: imported, synced_at: at('2026-11-28T09:30:00Z') },
        60,
        now,
      ),
    ).toBeNull()
    expect(
      costWork(
        { status: 'ok', imported_at: imported, synced_at: at('2026-11-28T09:00:00Z') },
        60,
        now,
      ),
    ).toBe('sync')
  })
})

describe('cost rows', () => {
  const items = [
    {
      at: at('2026-11-28T10:00:00Z'),
      hours: 1,
      tag: 'w1',
      lineItem: 'opus',
      amount: 100,
      currency: 'USD',
    },
    {
      at: at('2026-11-28T10:00:00Z'),
      hours: 1,
      tag: 'w1',
      lineItem: 'haiku',
      amount: 20,
      currency: 'USD',
    },
    {
      at: at('2026-11-28T11:00:00Z'),
      hours: 1,
      tag: 'w1',
      lineItem: 'opus',
      amount: 50,
      currency: 'USD',
    },
    {
      at: at('2026-11-27T00:00:00Z'),
      hours: 24,
      tag: '',
      lineItem: 'opus',
      amount: 900,
      currency: 'USD',
    },
  ]

  it('sums items per day, tag and line item', () => {
    expect(costDays(items)).toEqual([
      { day: '2026-11-28', tag: 'w1', lineItem: 'opus', amount: 150, currency: 'USD' },
      { day: '2026-11-28', tag: 'w1', lineItem: 'haiku', amount: 20, currency: 'USD' },
      { day: '2026-11-27', tag: '', lineItem: 'opus', amount: 900, currency: 'USD' },
    ])
  })

  it('keeps hours only from hourly items, per tag', () => {
    expect(costHours(items).map((h) => [h.hour.toISOString(), h.tag, h.amount])).toEqual([
      ['2026-11-28T10:00:00.000Z', 'w1', 120],
      ['2026-11-28T11:00:00.000Z', 'w1', 50],
    ])
  })

  it('counts what today grew since the last read, never less than nothing', () => {
    const before = new Map([
      ['proj_a', 100],
      ['proj_b', 50],
    ])
    const today = [
      { day: '2026-11-28', tag: 'proj_a', lineItem: 'x', amount: 130, currency: 'USD' },
      { day: '2026-11-28', tag: 'proj_b', lineItem: 'x', amount: 40, currency: 'USD' },
      { day: '2026-11-28', tag: 'proj_c', lineItem: 'x', amount: 5, currency: 'USD' },
    ]
    expect(growth(before, today)).toEqual(
      new Map([
        ['proj_a', 30],
        ['proj_c', 5],
      ]),
    )
  })
})

describe('costRunaway', () => {
  it('needs the multiple of a normal hour and the dollar floor', () => {
    const params = { times: 3, dollars: 5 }
    expect(costRunaway(900, 200, params)).toBe(true)
    expect(costRunaway(500, 200, params)).toBe(false)
    expect(costRunaway(300, 50, params)).toBe(false)
    expect(costRunaway(600, 0, params)).toBe(true)
  })
})
