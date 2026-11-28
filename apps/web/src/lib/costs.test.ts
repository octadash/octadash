import { describe, expect, it } from 'vitest'
import {
  costPeriod,
  costsHref,
  daysBetween,
  forecastMonth,
  marginOf,
  parseAmount,
  parseCostsState,
} from './costs'

describe('costs state', () => {
  it('defaults to this month', () => {
    expect(parseCostsState({})).toEqual({ period: 'month' })
    expect(parseCostsState({ period: '7d' })).toEqual({ period: '7d' })
    expect(costsHref('/all/costs', { period: 'month' })).toBe('/all/costs')
    expect(costsHref('/all/costs', { period: '30d' })).toBe('/all/costs?period=30d')
  })
})

describe('costPeriod', () => {
  it('compares this month with the same days of last month', () => {
    expect(costPeriod('month', '2026-11-28')).toEqual({
      from: '2026-11-01',
      to: '2026-11-28',
      previous: { from: '2026-10-01', to: '2026-10-28' },
    })
    expect(costPeriod('month', '2026-03-31').previous).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })

  it('compares the last days with as many before', () => {
    expect(costPeriod('7d', '2026-11-28')).toEqual({
      from: '2026-11-22',
      to: '2026-11-28',
      previous: { from: '2026-11-15', to: '2026-11-21' },
    })
    expect(daysBetween('2026-11-29', '2026-12-02')).toEqual([
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
    ])
  })
})

describe('forecast and margin', () => {
  it('adds the last week’s daily average for each day left', () => {
    expect(forecastMonth(2800, 700, '2026-11-28')).toBe(3000)
  })
  it('is null without revenue', () => {
    expect(marginOf(1000, 130)).toBe(87)
    expect(marginOf(0, 10)).toBeNull()
  })
})

describe('parseAmount', () => {
  it('reads both decimal styles and thousands', () => {
    expect(parseAmount('1500')).toBe(150_000)
    expect(parseAmount('1,500.50')).toBe(150_050)
    expect(parseAmount('1.500,50')).toBe(150_050)
    expect(parseAmount('49,9')).toBe(4990)
    expect(parseAmount('US$ 20')).toBe(2000)
    expect(parseAmount('1.500')).toBe(150_000)
    expect(parseAmount('5000', 0)).toBe(5000)
  })
  it('refuses what is not an amount', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('-5')).toBeNull()
  })
})
