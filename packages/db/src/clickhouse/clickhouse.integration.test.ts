import { afterAll, describe, expect, it } from 'vitest'
import { createClickHouse, parseClickHouseUrl } from './client'
import { insertEvents, toClickHouseTime } from './events'
import { migrateClickHouse } from './migrate'
import { insertUptimeChecks, monitorStats } from './uptime'

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
    expect(Math.abs((s?.lastAt?.getTime() ?? 0) - (Date.now() - 60_000))).toBeLessThan(5_000)
  })
})
