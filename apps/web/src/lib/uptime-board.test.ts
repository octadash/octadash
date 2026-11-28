import { describe, expect, it } from 'vitest'
import {
  type BoardMonitor,
  barState,
  type MonitorNumbers,
  monitorState,
  type OpenMonitorIncident,
  parseUptimePeriod,
  sameIpGroups,
  statusCodeOf,
  uptimePeriod,
  worstState,
} from './uptime-board'

const NOW = new Date('2026-11-28T12:00:00Z')

function monitor(overrides: Partial<BoardMonitor> = {}): BoardMonitor {
  return {
    kind: 'site',
    status: 'up',
    status_since: null,
    paused: false,
    interval_seconds: 60,
    grace_seconds: 1800,
    schedule: null,
    updated_at: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  }
}

function numbers(overrides: Partial<MonitorNumbers> = {}): MonitorNumbers {
  return {
    lastAt: new Date(NOW.getTime() - 30_000),
    lastUp: true,
    lastError: null,
    periodMedianMs: 180,
    recentMedianMs: 190,
    ...overrides,
  }
}

describe('uptime periods', () => {
  it('defaults to 45 days and cuts a day in hours', () => {
    expect(parseUptimePeriod(undefined)).toBe('45d')
    expect(parseUptimePeriod('nope')).toBe('45d')
    expect(uptimePeriod('24h', NOW).bucket).toBe('hour')
    const p = uptimePeriod('90d', NOW)
    expect(p.bucket).toBe('day')
    expect(p.previous.to).toEqual(p.from)
  })
})

describe('monitorState', () => {
  it('reads paused, down, waiting and up', () => {
    expect(monitorState(monitor({ paused: true, status: 'down' }), numbers(), 'UTC', NOW)).toEqual({
      state: 'paused',
    })
    const since = new Date('2026-11-28T11:46:00Z')
    expect(
      monitorState(
        monitor({ status: 'down', status_since: since }),
        numbers({ lastError: 'HTTP 502' }),
        'UTC',
        NOW,
      ),
    ).toEqual({ state: 'down', since, reason: 'HTTP 502' })
    expect(
      monitorState(monitor({ status: 'unknown' }), numbers({ lastAt: null }), 'UTC', NOW),
    ).toEqual({ state: 'waiting' })
    expect(monitorState(monitor(), numbers(), 'UTC', NOW).state).toBe('up')
  })

  it('calls a monitor slow only when the last hour is both slow and far above its usual', () => {
    expect(
      monitorState(monitor(), numbers({ recentMedianMs: 2400, periodMedianMs: 300 }), 'UTC', NOW),
    ).toEqual({ state: 'slow', medianMs: 2400 })
    // Always this slow: that is its normal, not a change.
    expect(
      monitorState(monitor(), numbers({ recentMedianMs: 2400, periodMedianMs: 2300 }), 'UTC', NOW)
        .state,
    ).toBe('up')
    expect(
      monitorState(monitor(), numbers({ recentMedianMs: 900, periodMedianMs: 100 }), 'UTC', NOW)
        .state,
    ).toBe('up')
  })

  it('says a heartbeat is late inside its grace, and when it was last called', () => {
    const daily = monitor({ kind: 'heartbeat', schedule: '0 3 * * *', interval_seconds: 86_400 })
    const lastCall = new Date('2026-11-27T03:01:00Z')
    expect(monitorState(daily, numbers({ lastAt: lastCall }), 'UTC', NOW)).toEqual({
      state: 'late',
      due: new Date('2026-11-28T03:00:00Z'),
    })
    const early = new Date('2026-11-28T02:00:00Z')
    expect(monitorState(daily, numbers({ lastAt: lastCall }), 'UTC', early)).toEqual({
      state: 'up',
      lastCall,
    })
    expect(
      monitorState(
        monitor({
          kind: 'heartbeat',
          status: 'unknown',
          updated_at: new Date(NOW.getTime() - 1000),
        }),
        numbers({ lastAt: null, lastUp: null }),
        'UTC',
        NOW,
      ),
    ).toEqual({ state: 'waiting' })
  })
})

describe('worstState and barState', () => {
  it('picks the worst monitor', () => {
    const up = { name: 'a', state: { state: 'up', lastCall: null } as const }
    const slow = { name: 'b', state: { state: 'slow', medianMs: 2400 } as const }
    expect(worstState([up, slow])?.name).toBe('b')
    expect(worstState([])).toBeNull()
  })

  it('paints a bar by how many checks failed', () => {
    expect(barState({ checks: 0, downs: 0 })).toBe('none')
    expect(barState({ checks: 1440, downs: 0 })).toBe('up')
    expect(barState({ checks: 1440, downs: 14 })).toBe('partial')
    expect(barState({ checks: 10, downs: 5 })).toBe('down')
  })
})

describe('sameIpGroups', () => {
  const incident = (
    id: string,
    project: string,
    minute: number,
    ip: string | null,
    kind = 'monitor_down',
  ): OpenMonitorIncident => ({
    id,
    kind,
    project_id: project,
    project_name: project,
    project_slug: project,
    started_at: new Date(NOW.getTime() + minute * 60_000),
    data: { ip },
  })

  it('groups different products on one address that went down close together', () => {
    const groups = sameIpGroups([
      incident('1', 'api', 0, '203.0.113.7'),
      incident('2', 'blog', 1, '203.0.113.7'),
      incident('3', 'shop', 2, '198.51.100.1'),
      incident('4', 'docs', 40, '203.0.113.7'),
      incident('5', 'shop', 2, '203.0.113.7', 'cert_expiring'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.ip).toBe('203.0.113.7')
    expect(groups[0]?.incidents.map((i) => i.id)).toEqual(['1', '2'])
    expect(groups[0]?.apartMinutes).toBe(1)
  })

  it('needs two products: two monitors of one product are not a hint', () => {
    expect(
      sameIpGroups([
        incident('1', 'api', 0, '203.0.113.7'),
        incident('2', 'api', 0, '203.0.113.7'),
      ]),
    ).toEqual([])
  })

  it('reads a status code out of a reason', () => {
    expect(statusCodeOf('HTTP 502')).toBe('502')
    expect(statusCodeOf('timeout')).toBeNull()
    expect(statusCodeOf(null)).toBeNull()
  })
})
