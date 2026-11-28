import { createLogger } from '@octadash/core'
import type { ActiveMonitor, MonitorStatus, UptimeCheckRow } from '@octadash/db'
import type { CheckResult } from '@octadash/uptime'
import { describe, expect, it } from 'vitest'
import { type Transition, UptimeScheduler } from './uptime'

const T0 = Date.parse('2026-11-28T12:00:00Z')

function monitor(overrides: Partial<ActiveMonitor> = {}): ActiveMonitor {
  return {
    id: 'm1',
    org_id: 'o1',
    project_id: 'p1',
    name: 'Site',
    kind: 'site',
    url: 'https://example.com',
    interval_seconds: 60,
    grace_seconds: 0,
    heartbeat_token: null,
    schedule: null,
    timeout_seconds: 10,
    time_zone: 'UTC',
    status: 'unknown',
    status_since: null,
    updated_at: new Date(T0 - 3_600_000),
    ...overrides,
  }
}

function result(up: boolean, overrides: Partial<CheckResult> = {}): CheckResult {
  return {
    url: 'https://example.com',
    up,
    status: up ? 200 : 503,
    durationMs: 120,
    error: up ? null : 'HTTP 503',
    ip: '203.0.113.7',
    finalUrl: 'https://example.com/',
    redirects: [],
    httpsRedirect: null,
    tls: null,
    ...overrides,
  }
}

function setup(monitors: ActiveMonitor[], answers: boolean[] = [], online = { value: true }) {
  let now = T0
  const rows: UptimeCheckRow[] = []
  const transitions: Transition[] = []
  const statuses = new Map<string, MonitorStatus>(monitors.map((m) => [m.id, m.status]))
  const pings = new Map<string, number>()
  const failures = new Map<string, number>()
  const checks: { deep?: boolean }[] = []
  const scheduler = new UptimeScheduler({
    loadMonitors: async () => monitors,
    check: async (_url, options) => {
      checks.push({ deep: options.deep })
      return result(
        answers.shift() ?? true,
        options.deep ? { tls: { validTo: '', daysLeft: 20, issuer: null, trusted: true } } : {},
      )
    },
    readPings: async (ids) =>
      new Map(ids.flatMap((id) => (pings.has(id) ? [[id, pings.get(id) as number] as const] : []))),
    readFailures: async (ids) =>
      new Map(
        ids.flatMap((id) => (failures.has(id) ? [[id, failures.get(id) as number] as const] : [])),
      ),
    writeRows: async (batch) => {
      rows.push(...batch)
    },
    setStatus: async (id, from, to) => {
      if (statuses.get(id) !== from) return false
      statuses.set(id, to)
      return true
    },
    onTransition: async (t) => {
      transitions.push(t)
    },
    isOnline: async () => online.value,
    now: () => now,
    log: createLogger('test', 'silent'),
  })
  /** Advances the clock second by second, ticking like the real loop. */
  const advance = async (ms: number) => {
    const end = now + ms
    while (now < end) {
      now = Math.min(end, now + 1_000)
      await scheduler.tick()
      await scheduler.drain()
    }
    await scheduler.flush()
  }
  return {
    scheduler,
    rows,
    transitions,
    statuses,
    pings,
    failures,
    checks,
    advance,
    setNow: (t: number) => (now = t),
  }
}

describe('UptimeScheduler', () => {
  it('checks on time, writes results and reads the certificate on the first check', async () => {
    const t = setup([monitor()])
    await t.scheduler.reload()
    await t.advance(130_000)
    expect(t.rows.length).toBe(3)
    expect(t.checks[0]?.deep).toBe(true)
    expect(t.checks.slice(1).every((c) => !c.deep)).toBe(true)
    expect(t.rows[0]).toMatchObject({ monitor_id: 'm1', up: 1, status_code: 200, cert_days: 20 })
    expect(t.transitions.map((x) => `${x.from}>${x.to}`)).toEqual(['unknown>up'])
  })

  it('goes down after 3 failures in a row, checking sooner after each failure, and recovers', async () => {
    const t = setup([monitor({ status: 'up' })], [false, false, false, true])
    await t.scheduler.reload()
    await t.advance(11_000) // first check (spread over the first 10 s)
    expect(t.transitions).toEqual([])
    await t.advance(41_000) // two retries 20 s apart
    expect(t.transitions.map((x) => `${x.from}>${x.to}`)).toEqual(['up>down'])
    expect(t.transitions[0]).toMatchObject({ reason: 'HTTP 503', ip: '203.0.113.7' })
    await t.advance(21_000)
    expect(t.transitions.map((x) => `${x.from}>${x.to}`)).toEqual(['up>down', 'down>up'])
    expect(t.statuses.get('m1')).toBe('up')
  })

  it('calls nothing down while this server is offline', async () => {
    const online = { value: false }
    const t = setup(
      [monitor({ status: 'up' }), monitor({ id: 'm2', status: 'up' })],
      Array(20).fill(false),
      online,
    )
    await t.scheduler.reload()
    await t.advance(120_000)
    expect(t.transitions).toEqual([])
    online.value = true
    await t.advance(60_000)
    expect(t.transitions.map((x) => `${x.monitor.id} ${x.to}`).sort()).toEqual([
      'm1 down',
      'm2 down',
    ])
  })

  it('does not go down on one or two failures', async () => {
    const t = setup([monitor({ status: 'up' })], [false, false, true, false, false, true])
    await t.scheduler.reload()
    await t.advance(300_000)
    expect(t.transitions).toEqual([])
  })

  it('calls a heartbeat down after its interval plus grace without a ping, and up when it pings', async () => {
    const beat = monitor({
      id: 'hb',
      kind: 'heartbeat',
      url: null,
      heartbeat_token: 'x',
      interval_seconds: 300,
      grace_seconds: 60,
      status: 'up',
      updated_at: new Date(T0 - 3_600_000),
    })
    const t = setup([beat])
    t.pings.set('hb', T0 - 200_000)
    await t.scheduler.reload()
    await t.advance(30_000)
    expect(t.transitions).toEqual([])
    expect(t.rows.filter((r) => r.up === 1)).toHaveLength(1)
    await t.advance(150_000) // 380 s since the ping > 360 s allowed
    expect(t.transitions.map((x) => `${x.from}>${x.to}`)).toEqual(['up>down'])
    expect(t.transitions[0]?.reason).toBe('no ping for 6 min')
    await t.advance(60_000)
    expect(t.transitions).toHaveLength(1)
    t.pings.set('hb', T0 + 240_000)
    await t.advance(20_000)
    expect(t.transitions.map((x) => `${x.from}>${x.to}`)).toEqual(['up>down', 'down>up'])
  })

  it('gives a new heartbeat its interval before calling it down', async () => {
    const beat = monitor({
      id: 'hb',
      kind: 'heartbeat',
      url: null,
      interval_seconds: 600,
      updated_at: new Date(T0),
    })
    const t = setup([beat])
    await t.scheduler.reload()
    await t.advance(590_000)
    expect(t.transitions).toEqual([])
    await t.advance(30_000)
    expect(t.transitions.map((x) => `${x.from}>${x.to} ${x.reason}`)).toEqual([
      'unknown>down no ping yet',
    ])
  })

  it('calls a heartbeat down at once when its job reports failure, and up on the next good call', async () => {
    const beat = monitor({
      id: 'hb',
      kind: 'heartbeat',
      url: null,
      interval_seconds: 86_400,
      grace_seconds: 1800,
      status: 'up',
    })
    const t = setup([beat])
    t.pings.set('hb', T0 - 60_000)
    await t.scheduler.reload()
    await t.advance(20_000)
    t.failures.set('hb', T0 + 20_000)
    await t.advance(20_000)
    expect(t.transitions.map((x) => `${x.from}>${x.to} ${x.reason}`)).toEqual([
      'up>down job reported failure',
    ])
    expect(t.rows.filter((r) => r.error === 'job reported failure')).toHaveLength(1)
    t.pings.set('hb', T0 + 60_000)
    await t.advance(20_000)
    expect(t.transitions.map((x) => `${x.from}>${x.to}`)).toEqual(['up>down', 'down>up'])
  })

  it('reads a heartbeat cron schedule in the organization time zone', async () => {
    // Every day at 9:00 AM São Paulo = 12:00 UTC; the call came at 9:05 yesterday.
    const beat = monitor({
      id: 'hb',
      kind: 'heartbeat',
      url: null,
      interval_seconds: 86_400,
      grace_seconds: 600,
      schedule: '0 9 * * *',
      time_zone: 'America/Sao_Paulo',
      status: 'up',
      updated_at: new Date(T0 - 3 * 86_400_000),
    })
    const t = setup([beat])
    t.pings.set('hb', T0 - 86_400_000 + 300_000)
    await t.scheduler.reload()
    await t.advance(590_000)
    expect(t.transitions).toEqual([])
    await t.advance(30_000)
    expect(t.transitions.map((x) => `${x.from}>${x.to}`)).toEqual(['up>down'])
  })

  it('drops deleted monitors and rechecks edited ones at once', async () => {
    const monitors = [monitor(), monitor({ id: 'm2' })]
    const t = setup(monitors)
    await t.scheduler.reload()
    await t.advance(15_000)
    expect(t.scheduler.size).toBe(2)
    const before = t.checks.length
    monitors.splice(1, 1)
    monitors[0] = monitor({ updated_at: new Date(T0 + 15_000), url: 'https://new.example.com' })
    await t.scheduler.reload()
    expect(t.scheduler.size).toBe(1)
    await t.advance(1_000)
    expect(t.checks.length).toBe(before + 1)
  })

  it('keeps results when ClickHouse refuses them', async () => {
    const t = setup([monitor()])
    let fail = true
    const written: number[] = []
    // biome-ignore lint/suspicious/noExplicitAny: swapping a private dependency in a test
    ;(t.scheduler as any).deps.writeRows = async (batch: UptimeCheckRow[]) => {
      if (fail) throw new Error('down')
      written.push(batch.length)
    }
    await t.scheduler.reload()
    await t.advance(130_000)
    fail = false
    await t.scheduler.flush()
    expect(written).toEqual([3])
  })
})
