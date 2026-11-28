import { describe, expect, it } from 'vitest'
import { isValidSchedule, judgeHeartbeat, nextDue } from './heartbeat'

const at = (iso: string) => new Date(iso)
const every5 = { intervalSeconds: 300, schedule: null, graceSeconds: 60, timeZone: 'UTC' }
const nightly = {
  intervalSeconds: 86_400,
  schedule: '0 3 * * *',
  graceSeconds: 30 * 60,
  timeZone: 'America/Sao_Paulo',
}

describe('heartbeat schedule', () => {
  it('reads five-field cron only', () => {
    expect(isValidSchedule('0 3 * * *')).toBe(true)
    expect(isValidSchedule('*/15 * * * 1-5')).toBe(true)
    expect(isValidSchedule('0 3 * *')).toBe(false)
    expect(isValidSchedule('every night')).toBe(false)
  })

  it('reads the schedule in the organization time zone', () => {
    // 3:00 AM in São Paulo (UTC−3) is 06:00 UTC.
    expect(nextDue(nightly, at('2026-11-28T00:00:00Z')).toISOString()).toBe(
      '2026-11-28T06:00:00.000Z',
    )
    expect(nextDue(every5, at('2026-11-28T00:00:00Z')).toISOString()).toBe(
      '2026-11-28T00:05:00.000Z',
    )
  })
})

describe('judging a heartbeat', () => {
  const since = at('2026-11-27T12:00:00Z')

  it('waits before the first due time, then calls it late after the grace', () => {
    expect(
      judgeHeartbeat(
        nightly,
        { lastCall: null, lastFail: null, since },
        at('2026-11-28T06:20:00Z'),
      ),
    ).toMatchObject({ state: 'waiting' })
    expect(
      judgeHeartbeat(
        nightly,
        { lastCall: null, lastFail: null, since },
        at('2026-11-28T06:31:00Z'),
      ),
    ).toMatchObject({ state: 'late', firstCall: true })
  })

  it('expects the next run after each call', () => {
    const lastCall = at('2026-11-28T06:10:00Z') // the 3:00 AM backup finished at 3:10
    expect(
      judgeHeartbeat(nightly, { lastCall, lastFail: null, since }, at('2026-11-29T06:25:00Z')),
    ).toEqual({ state: 'up' })
    expect(
      judgeHeartbeat(nightly, { lastCall, lastFail: null, since }, at('2026-11-29T06:31:00Z')),
    ).toMatchObject({ state: 'late', firstCall: false })
  })

  it('fails at once on /fail, and a good call clears it', () => {
    const lastFail = at('2026-11-28T06:05:00Z')
    expect(
      judgeHeartbeat(
        nightly,
        { lastCall: at('2026-11-27T06:05:00Z'), lastFail, since },
        at('2026-11-28T06:06:00Z'),
      ),
    ).toEqual({ state: 'failed', at: lastFail })
    expect(
      judgeHeartbeat(
        nightly,
        { lastCall: at('2026-11-28T06:20:00Z'), lastFail, since },
        at('2026-11-28T06:21:00Z'),
      ),
    ).toEqual({ state: 'up' })
  })
})
