import { describe, expect, it } from 'vitest'
import { describeFailure, durationLabel, productUptime, worstStatus } from './monitors'

describe('monitors', () => {
  it('names intervals in the largest whole unit', () => {
    const t = (key: string, { count }: { count: number }) => `${count} ${key}`
    expect(durationLabel(30, t)).toBe('30 seconds')
    expect(durationLabel(300, t)).toBe('5 minutes')
    expect(durationLabel(21_600, t)).toBe('6 hours')
  })

  it('takes the worst state of a product', () => {
    expect(worstStatus([])).toBe('none')
    expect(worstStatus(['up', 'unknown'])).toBe('unknown')
    expect(worstStatus(['up', 'down', 'unknown'])).toBe('down')
    expect(worstStatus(['up', 'up'])).toBe('up')
  })

  it('sums a product up across monitors, leaving paused ones out', () => {
    const stat = (
      id: string,
      checks: number,
      uptime: number,
      medianMs: number,
      certDays: number | null,
    ) => ({
      monitorId: id,
      checks,
      uptime,
      medianMs,
      lastAt: null,
      lastUp: true,
      lastError: null,
      certDays,
    })
    const summary = productUptime(
      [
        { id: 'a', status: 'up', paused: false },
        { id: 'b', status: 'up', paused: false },
        { id: 'c', status: 'down', paused: true },
      ],
      new Map([
        ['a', stat('a', 100, 1, 120, 40)],
        ['b', stat('b', 300, 0.9, 300, 12)],
        ['c', stat('c', 100, 0, 9000, 1)],
      ]),
    )
    expect(summary).toEqual({
      status: 'up',
      monitors: 3,
      uptime: 0.925,
      medianMs: 300,
      certDays: 12,
    })
  })
  it('describes failures in words', () => {
    const t = (key: string, values?: Record<string, string | number>) =>
      values ? `${key} ${Object.values(values).join(' ')}` : key
    expect(describeFailure('ECONNREFUSED', t)).toBe('refused')
    expect(describeFailure('HTTP 503', t)).toBe('http 503')
    expect(describeFailure('no ping for 65 min', t)).toBe('noPingFor 65')
    expect(describeFailure('ERR_SSL_WRONG_VERSION_NUMBER', t)).toBe(
      'tls ERR_SSL_WRONG_VERSION_NUMBER',
    )
    expect(describeFailure('localhost resolves to a private address', t)).toBe('private')
    expect(describeFailure('EWHATEVER', t)).toBe('other EWHATEVER')
  })
})
