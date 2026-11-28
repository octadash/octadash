import { describe, expect, it } from 'vitest'
import { signupsDropped } from './alerts'

const at = new Date('2026-11-28T12:00:00Z')
const params = { drop: 30, signups: 10 }
const daysAgo = (days: number) => new Date(at.getTime() - days * 86_400_000)
// 4 weeks of 700 sign-ups, these 24 weekday hours holding 1/7 of them; 140 in the last 7 days.
const usual = { lastWeek: 140, sameHours: 100, fourWeeks: 700, oldest: daysAgo(34) }

describe('signupsDropped', () => {
  it('expects shape × level and drops at 30% under', () => {
    expect(signupsDropped({ ...usual, last24h: 20 }, at, params)).toEqual({
      learning: false,
      expected: 20,
      percent: 0,
      dropped: false,
    })
    expect(signupsDropped({ ...usual, last24h: 14 }, at, params).dropped).toBe(true)
    expect(signupsDropped({ ...usual, last24h: 15 }, at, params).dropped).toBe(false)
    expect(signupsDropped({ ...usual, last24h: 13 }, at, params).percent).toBe(-35)
  })

  it('follows the level: a campaign week raises what is expected', () => {
    const check = signupsDropped({ ...usual, lastWeek: 280, last24h: 25 }, at, params)
    expect(check.expected).toBe(40)
    expect(check.dropped).toBe(true)
  })

  it('follows the shape: a quiet weekday expects few', () => {
    const quiet = { ...usual, sameHours: 20, last24h: 2 }
    expect(signupsDropped(quiet, at, params)).toMatchObject({ expected: 4, dropped: false })
  })

  it('needs 4 weeks of sign-ups and enough expected', () => {
    expect(signupsDropped({ ...usual, oldest: daysAgo(20), last24h: 0 }, at, params)).toMatchObject(
      { learning: true, dropped: false },
    )
    const small = { lastWeek: 21, sameHours: 12, fourWeeks: 84, oldest: daysAgo(34), last24h: 0 }
    expect(signupsDropped(small, at, params)).toMatchObject({ expected: 3, dropped: false })
  })

  it('takes the product’s own numbers', () => {
    const check = signupsDropped({ ...usual, last24h: 15 }, at, { drop: 20, signups: 10 })
    expect(check.dropped).toBe(true)
  })
})
