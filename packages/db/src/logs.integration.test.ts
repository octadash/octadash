import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClickHouse } from './clickhouse/client'
import { insertErrors } from './clickhouse/errors'
import { NO_SOURCE } from './clickhouse/events'
import { compileLogQuery, parseLogQuery } from './clickhouse/log-query'
import {
  errorsInTraces,
  insertLogs,
  type LogRow,
  lastLogLine,
  logHistogram,
  logMatches,
  maskedCount,
  searchLogs,
} from './clickhouse/logs'
import { migrateClickHouse } from './clickhouse/migrate'
import { createDb } from './client'
import {
  deleteLogSearch,
  listLogSearches,
  logRetention,
  saveLogSearch,
  setLogRetention,
} from './logs'
import { migrateToLatest } from './migrate'
import { createProject } from './projects'

const url = process.env.DATABASE_URL
const chUrl = process.env.CLICKHOUSE_URL
const org = '00000000-0000-4000-8000-0000000004a1'

describe.skipIf(!url)('log retention and saved searches (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })
  let product = ''

  beforeAll(async () => {
    await migrateToLatest(db)
    await db.deleteFrom('project').where('org_id', '=', org).execute()
    await db.deleteFrom('log_search').where('org_id', '=', org).execute()
    product = (await createProject(db, org, { name: 'Logs Shop' })).id
  })
  afterAll(async () => {
    await db.deleteFrom('log_search').where('org_id', '=', org).execute()
    await db.deleteFrom('project').where('org_id', '=', org).execute()
    await pool.end()
  })

  it('keeps 14 days unless the product chose otherwise', async () => {
    expect((await logRetention(db, [product])).get(product)).toBe(14)
    expect(await setLogRetention(db, org, product, 30)).toBe(14)
    expect((await logRetention(db, [product])).get(product)).toBe(30)
    expect(await setLogRetention(db, org, product, 7)).toBe(30)
    // Another organization's product is not changed.
    expect(
      await setLogRetention(db, '00000000-0000-4000-8000-0000000004ff', product, 90),
    ).toBeNull()
  })

  it('saves searches and starts an alert from when it was turned on', async () => {
    const t1 = new Date('2026-11-28T10:00:00Z')
    const id = await saveLogSearch(
      db,
      org,
      { name: 'Timeouts', query: '"timeout"', alert: false },
      null,
    )
    expect(await listLogSearches(db, null)).not.toContainEqual(expect.objectContaining({ id }))
    await saveLogSearch(
      db,
      org,
      { name: 'Timeouts', query: '"timeout"', alert: true },
      null,
      id ?? '',
      t1,
    )
    await saveLogSearch(
      db,
      org,
      { name: 'DB timeouts', query: '"timeout"', alert: true },
      null,
      id ?? '',
      new Date('2026-11-28T11:00:00Z'),
    )
    const [search] = await listLogSearches(db, org)
    expect(search).toMatchObject({ name: 'DB timeouts', alert: true, alertSince: t1 })
    expect(
      await saveLogSearch(
        db,
        org,
        { name: 'x', query: 'x', alert: false },
        null,
        crypto.randomUUID(),
      ),
    ).toBeNull()
    await deleteLogSearch(db, org, id ?? '')
    expect(await listLogSearches(db, org)).toEqual([])
  })
})

describe.skipIf(!chUrl)('log queries (needs CLICKHOUSE_URL)', () => {
  const client = createClickHouse(chUrl ?? '')
  const project = '00000000-0000-4000-8000-0000000004a2'
  const source = '00000000-0000-4000-8000-0000000004a3'
  const T0 = new Date('2026-11-28T12:00:00Z')
  const time = (minutes: number, ns = '000000000') => {
    const iso = new Date(T0.getTime() + minutes * 60_000).toISOString()
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)}.${ns}`
  }
  const line = (
    minutes: number,
    level: string,
    body: string,
    extra: Partial<LogRow> = {},
  ): LogRow => ({
    org_id: org,
    project_id: project,
    source_id: source,
    timestamp: time(minutes),
    observed_at: time(minutes).slice(0, 23),
    severity_number: 9,
    level,
    service: 'api',
    body,
    trace_id: '',
    span_id: '',
    scope: '',
    attributes: {},
    resource: { 'service.name': 'api' },
    masked: 0,
    retention_days: 14,
    ...extra,
  })
  const trace = 'ab'.repeat(16)
  const scope = {
    orgId: org,
    projectIds: [project],
    from: new Date(T0.getTime() - 3_600_000),
    to: new Date(T0.getTime() + 3_600_000),
  }
  const all = compileLogQuery([])

  beforeAll(async () => {
    await migrateClickHouse(chUrl ?? '')
    await client.command({ query: `DELETE FROM logs WHERE org_id = '${org}'` })
    await client.command({ query: `DELETE FROM errors WHERE org_id = '${org}'` })
    await insertLogs(
      client,
      [
        line(-30, 'info', 'POST /orders 201 in 182 ms', { attributes: { duration_ms: '182' } }),
        line(-20, 'warn', 'Retrying connection to db-1', { service: 'worker' }),
        line(-10, 'error', 'NpgsqlException: Timeout during reading', {
          trace_id: trace,
          attributes: { duration_ms: '30012', 'http.route': 'POST /orders' },
          masked: 2,
        }),
        line(-5, 'fatal', 'Out of memory'),
      ],
      crypto.randomUUID(),
    )
    await insertErrors(
      client,
      [
        {
          org_id: org,
          project_id: project,
          source_id: NO_SOURCE,
          issue_id: '00000000-0000-4000-8000-0000000004a9',
          event_id: 'e'.repeat(32),
          fingerprint: 'f',
          timestamp: time(-10).slice(0, 23),
          received_at: time(-10).slice(0, 23),
          type: 'NpgsqlException',
          value: 'Timeout',
          level: 'error',
          handled: 0,
          platform: 'csharp',
          sdk: '',
          release: '',
          environment: '',
          culprit: '',
          url: '',
          path: '',
          browser: '',
          os: '',
          country: '',
          person: '',
          exception: '[]',
          breadcrumbs: '[]',
          tags: '{}',
          trace_id: trace,
        },
      ],
      crypto.randomUUID(),
    )
  })
  afterAll(async () => {
    await client.close()
  })

  const search = (q: string, options: { before?: string; after?: string } = {}) =>
    searchLogs(client, scope, compileLogQuery(parseLogQuery(q), new Map([['shop', project]])), {
      limit: 50,
      ...options,
    })

  it('finds lines by text, level, field, number and product, newest first', async () => {
    expect((await search('')).map((l) => l.level)).toEqual(['fatal', 'error', 'warn', 'info'])
    expect((await search('timeout')).map((l) => l.level)).toEqual(['error'])
    expect((await search('level>=error')).map((l) => l.body)).toEqual([
      'Out of memory',
      'NpgsqlException: Timeout during reading',
    ])
    expect((await search('service:worker')).map((l) => l.level)).toEqual(['warn'])
    expect((await search('duration_ms>2000')).map((l) => l.level)).toEqual(['error'])
    expect((await search('http.route:POST*')).map((l) => l.level)).toEqual(['error'])
    expect(await search('-level:info product:shop')).toHaveLength(3)
    expect(await search('product:other')).toEqual([])
    const [error] = await search(`trace:${trace}`)
    expect(error?.timestamp).toBe('2026-11-28T11:50:00.000000000Z')
  })

  it('pages back and takes only what is new', async () => {
    const [, second] = await search('')
    const older = await search('', { before: second?.timestamp })
    expect(older.map((l) => l.level)).toEqual(['warn', 'info'])
    const newer = await search('', { after: second?.timestamp })
    expect(newer.map((l) => l.level)).toEqual(['fatal'])
  })

  it('counts by level, masked values, matches and errors in a trace', async () => {
    const buckets = await logHistogram(client, scope, all, 900)
    expect(buckets).toHaveLength(8)
    const sum = (k: 'error' | 'warn' | 'info') => buckets.reduce((n, b) => n + b[k], 0)
    expect([sum('error'), sum('warn'), sum('info')]).toEqual([2, 1, 1])
    expect(await maskedCount(client, scope)).toBe(2)
    const matches = await logMatches(
      client,
      org,
      [project],
      compileLogQuery(parseLogQuery('level>=error')),
      new Date(T0.getTime() - 15 * 60_000),
      T0,
    )
    expect(matches).toEqual([
      { projectId: project, count: 2, last: new Date(T0.getTime() - 5 * 60_000) },
    ])
    const errors = await errorsInTraces(client, org, [trace, 'none'])
    expect(errors.get(trace)?.count).toBe(1)
    expect(errors.has('none')).toBe(false)
  })

  it('tells the newest line of a source', async () => {
    expect(await lastLogLine(client, org, project, source)).toEqual({
      at: '2026-11-28T11:55:00.000000000Z',
      service: 'api',
      body: 'Out of memory',
    })
    expect(await lastLogLine(client, org, project, NO_SOURCE)).toBeNull()
  })
})
