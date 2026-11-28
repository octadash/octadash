import { afterAll, describe, expect, it } from 'vitest'
import { bucketStarts } from './buckets'
import { createClickHouse, parseClickHouseUrl } from './client'
import { insertEvents, toClickHouseTime } from './events'
import { migrateClickHouse } from './migrate'
import {
  fillSeries,
  onlineNow,
  trafficBreakdown,
  trafficSeries,
  trafficSeriesByProduct,
  trafficSummary,
} from './traffic'
import {
  insertUptimeChecks,
  monitorChecks,
  monitorStats,
  responseSeries,
  uptimeHistory,
  uptimeTotals,
} from './uptime'

const url = process.env.CLICKHOUSE_URL

describe('parseClickHouseUrl', () => {
  it('reads credentials and the database from the path', () => {
    expect(parseClickHouseUrl('http://oc%40dash:p%2Fw@clickhouse:8123/octadash')).toEqual({
      url: 'http://clickhouse:8123',
      username: 'oc@dash',
      password: 'p/w',
      database: 'octadash',
    })
    expect(parseClickHouseUrl('https://ch.example.com').database).toBe('octadash')
    expect(() => parseClickHouseUrl('http://h:8123/bad-name;drop')).toThrow()
  })
})

describe.skipIf(!url)('clickhouse (needs CLICKHOUSE_URL)', () => {
  const client = createClickHouse(url ?? 'http://localhost:8123/octadash')
  const org = '00000000-0000-4000-8000-0000000000c1'

  afterAll(async () => {
    await client.command({ query: `DELETE FROM events WHERE org_id = '${org}'` }).catch(() => {})
    await client
      .command({ query: `DELETE FROM uptime_checks WHERE org_id = '${org}'` })
      .catch(() => {})
    await client.close()
  })

  it('applies migrations once', async () => {
    await migrateClickHouse(url ?? '')
    expect(await migrateClickHouse(url ?? '')).toEqual([])
    const tables = await (
      await client.query({ query: 'SHOW TABLES', format: 'JSONEachRow' })
    ).json<{ name: string }>()
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(['events', 'uptime_checks', 'octadash_migration']),
    )
  })

  it('writes events and ignores a retried batch with the same token', async () => {
    const now = toClickHouseTime(new Date())
    const row = {
      org_id: org,
      project_id: '00000000-0000-4000-8000-0000000000c2',
      source_id: '00000000-0000-4000-8000-0000000000c3',
      uuid: crypto.randomUUID(),
      timestamp: now,
      received_at: now,
      event: 'pageview',
      distinct_id: 'u1',
      session_id: '',
      properties: '{"path":"/"}',
    }
    const token = `test:${row.uuid}`
    await insertEvents(client, [row], token)
    await insertEvents(client, [row], token)
    const result = await (
      await client.query({
        query: 'SELECT count() AS n FROM events WHERE org_id = {org:UUID}',
        query_params: { org },
        format: 'JSONEachRow',
      })
    ).json<{ n: string }>()
    expect(Number(result[0]?.n)).toBe(1)
  })
  it('sums up uptime checks per monitor', async () => {
    const project = '00000000-0000-4000-8000-0000000000c2'
    const monitor = crypto.randomUUID()
    const other = crypto.randomUUID()
    const at = (minutesAgo: number) => toClickHouseTime(new Date(Date.now() - minutesAgo * 60_000))
    const base = { org_id: org, project_id: project, error: '', cert_days: null }
    await insertUptimeChecks(client, [
      {
        ...base,
        monitor_id: monitor,
        timestamp: at(3),
        up: 1,
        status_code: 200,
        duration_ms: 100,
        cert_days: 40,
      },
      { ...base, monitor_id: monitor, timestamp: at(2), up: 1, status_code: 200, duration_ms: 300 },
      {
        ...base,
        monitor_id: monitor,
        timestamp: at(1),
        up: 0,
        status_code: 503,
        duration_ms: 50,
        error: 'HTTP 503',
      },
      { ...base, monitor_id: other, timestamp: at(1), up: 1, status_code: 200, duration_ms: 10 },
    ])
    const stats = await monitorStats(client, org, [monitor, crypto.randomUUID()])
    expect(stats.size).toBe(1)
    const s = stats.get(monitor)
    expect(s).toMatchObject({
      checks: 3,
      lastUp: false,
      lastError: 'HTTP 503',
      certDays: 40,
      medianMs: 200,
    })
    expect(s?.uptime).toBeCloseTo(2 / 3)
    const checks = await monitorChecks(client, org, monitor, new Date(0), new Date())
    expect(checks.map((c) => [c.up, c.statusCode, c.error])).toEqual([
      [true, 200, ''],
      [true, 200, ''],
      [false, 503, 'HTTP 503'],
    ])
    expect(Math.abs((s?.lastAt?.getTime() ?? 0) - (Date.now() - 60_000))).toBeLessThan(5_000)
  })

  it('counts traffic for all products, a list or one, without bots', async () => {
    const a = crypto.randomUUID()
    const b = crypto.randomUUID()
    const day = new Date('2026-11-20T00:00:00Z')
    const at = (hours: number) => toClickHouseTime(new Date(day.getTime() + hours * 3_600_000))
    const base = {
      org_id: org,
      source_id: crypto.randomUUID(),
      received_at: at(0),
      distinct_id: '',
      session_id: '',
      properties: '{}',
      event: '$pageview',
      is_bot: 0,
    }
    const view = (project: string, hours: number, extra: Record<string, unknown>) => ({
      ...base,
      project_id: project,
      uuid: crypto.randomUUID(),
      timestamp: at(hours),
      ...extra,
    })
    await insertEvents(client, [
      view(a, 1, { visitor_id: 'v1', path: '/', referrer_host: 'google.com' }),
      view(a, 1, { visitor_id: 'v1', path: '/precos', referrer_host: 'google.com' }),
      view(a, 2, { visitor_id: 'v2', path: '/', utm_source: 'instagram' }),
      view(b, 2, { visitor_id: 'v3', path: '/', distinct_id: 'user-9' }),
      view(b, 3, { visitor_id: 'v4', path: '/', distinct_id: 'user-9' }),
      view(a, 3, { visitor_id: 'bot', path: '/', is_bot: 1 }),
      { ...view(a, 3, { visitor_id: 'v1' }), event: 'signup.completed' },
    ])
    const scope = { orgId: org, from: day, to: new Date(day.getTime() + 86_400_000) }
    expect(await trafficSummary(client, { ...scope, projectIds: null })).toEqual({
      pageviews: 5,
      visitors: 3,
      bots: 1,
    })
    expect(await trafficSummary(client, { ...scope, projectIds: [b] })).toMatchObject({
      pageviews: 2,
      visitors: 1,
    })
    expect(await trafficSummary(client, { ...scope, projectIds: [] })).toMatchObject({
      pageviews: 0,
    })
    const sources = await trafficBreakdown(client, { ...scope, projectIds: [a] }, 'source')
    expect(sources).toEqual([
      { value: 'google.com', pageviews: 2, visitors: 1 },
      { value: 'instagram', pageviews: 1, visitors: 1 },
    ])
    const series = await trafficSeries(client, { ...scope, projectIds: null }, 'hour')
    expect(series).toHaveLength(24)
    expect(series[1]).toEqual({ at: new Date('2026-11-20T01:00:00Z'), pageviews: 2, visitors: 1 })
    expect(series[0]?.pageviews).toBe(0)

    // Days start at local midnight: 03:00 UTC in São Paulo.
    const week = { ...scope, projectIds: null, to: new Date(day.getTime() + 2 * 86_400_000) }
    const days = await trafficSeries(client, { ...week, timeZone: 'America/Sao_Paulo' }, 'day')
    expect(days.map((d) => d.at.toISOString())).toEqual([
      '2026-11-19T03:00:00.000Z',
      '2026-11-20T03:00:00.000Z',
      '2026-11-21T03:00:00.000Z',
    ])
    // Hours 1 and 2 UTC are still the 19th there; hour 3 is the 20th.
    expect(days.map((d) => d.pageviews)).toEqual([4, 1, 0])

    const byProduct = await trafficSeriesByProduct(client, { ...scope, projectIds: null }, 'hour')
    expect(byProduct.get(b)?.map((p) => p.pageviews)).toEqual([1, 1])
    const filled = fillSeries(
      byProduct.get(b) ?? [],
      series.map((p) => p.at),
    )
    expect(filled).toHaveLength(24)
    expect(filled.slice(0, 4).map((p) => p.visitors)).toEqual([0, 0, 1, 1])

    const minuteAfter = new Date(day.getTime() + 3 * 3_600_000 + 60_000)
    expect(await onlineNow(client, { orgId: org, projectIds: null }, minuteAfter)).toBe(1)
    expect(await onlineNow(client, { orgId: org, projectIds: [a] }, minuteAfter)).toBe(0)
  })

  it('cuts days at local midnight, daylight saving time included', async () => {
    const starts = await bucketStarts(
      client,
      {
        from: new Date('2026-10-31T12:00:00Z'),
        to: new Date('2026-11-02T12:00:00Z'),
        timeZone: 'America/New_York',
      },
      'day',
    )
    expect(starts.map((d) => d.toISOString())).toEqual([
      '2026-10-31T04:00:00.000Z',
      '2026-11-01T04:00:00.000Z',
      '2026-11-02T05:00:00.000Z',
    ])
  })

  it('keeps an hour-by-hour uptime history per product', async () => {
    const a = crypto.randomUUID()
    const b = crypto.randomUUID()
    const day = new Date('2026-11-21T00:00:00Z')
    const at = (hours: number) => toClickHouseTime(new Date(day.getTime() + hours * 3_600_000))
    const check = (project: string, hours: number, up: 0 | 1) => ({
      org_id: org,
      project_id: project,
      monitor_id: crypto.randomUUID(),
      timestamp: at(hours),
      up,
      status_code: up ? 200 : 502,
      duration_ms: 100,
      error: up ? '' : 'HTTP 502',
      cert_days: null,
    })
    await insertUptimeChecks(client, [
      check(a, 0.5, 1),
      check(a, 0.6, 0),
      check(a, 5, 1),
      check(b, 1, 1),
    ])
    const scope = { orgId: org, from: day, to: new Date(day.getTime() + 86_400_000) }
    const history = await uptimeHistory(client, { ...scope, projectIds: [a] }, 'hour')
    expect([...history.keys()]).toEqual([a])
    const ofA = history.get(a)
    expect(ofA).toMatchObject({ checks: 3, ups: 2 })
    expect(ofA?.buckets).toHaveLength(24)
    expect(ofA?.buckets[0]).toMatchObject({ checks: 2, downs: 1 })
    expect(ofA?.buckets[1]).toMatchObject({ checks: 0, downs: 0 })
    expect(ofA?.buckets[5]).toMatchObject({ checks: 1, downs: 0 })
    expect(await uptimeHistory(client, { ...scope, projectIds: [] }, 'hour')).toEqual(new Map())
    const byMonitor = await uptimeHistory(client, { ...scope, projectIds: [a] }, 'day', 'monitor')
    expect(byMonitor.size).toBe(3)
    const response = await responseSeries(client, { ...scope, projectIds: [a] }, 'hour')
    expect(response).toHaveLength(24)
    expect(response[0]?.medianMs).toBe(100)
    expect(response[1]?.medianMs).toBeNull()
    expect(await uptimeTotals(client, { ...scope, projectIds: [a] })).toEqual({
      checks: 3,
      ups: 2,
      medianMs: 100,
    })
    expect(await uptimeTotals(client, { ...scope, projectIds: [] })).toEqual({
      checks: 0,
      ups: 0,
      medianMs: null,
    })
  })
})
