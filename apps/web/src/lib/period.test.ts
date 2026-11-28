import { describe, expect, it } from 'vitest'
import { parsePeriod, percentChange, periodOf } from './period'

describe('period', () => {
  it('falls back to 24 hours for anything unknown', () => {
    expect(parsePeriod('7d')).toBe('7d')
    expect(parsePeriod('1y')).toBe('24h')
    expect(parsePeriod(undefined)).toBe('24h')
    expect(parsePeriod(['30d'])).toBe('24h')
  })

  it('ends now and compares with the same length right before', () => {
    const now = new Date('2026-11-28T12:00:00Z')
    const week = periodOf('7d', now)
    expect(week.from.toISOString()).toBe('2026-11-21T12:00:00.000Z')
    expect(week.previous).toEqual({ from: new Date('2026-11-14T12:00:00Z'), to: week.from })
    expect([week.chart, week.row]).toEqual(['hour', 'day'])
    expect([periodOf('24h', now).row, periodOf('30d', now).chart]).toEqual(['hour', 'day'])
  })

  it('says nothing about change when the previous period had none', () => {
    expect(percentChange(111, 100)).toBe(11)
    expect(percentChange(65, 100)).toBe(-35)
    expect(percentChange(5, 0)).toBeNull()
  })
})
