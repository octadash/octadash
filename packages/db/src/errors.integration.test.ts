import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClickHouse } from './clickhouse/client'
import {
  type ErrorRow,
  errorRates,
  errorSeries,
  errorsByProduct,
  errorTotals,
  insertErrors,
  issueEvent,
  issueFacets,
  issuePeople,
  issueStats,
} from './clickhouse/errors'
import { migrateClickHouse } from './clickhouse/migrate'
import { createDb } from './client'
import {
  countIssues,
  countNewIssues,
  getIssue,
  type IssueHit,
  lastIssues,
  listIssues,
  recentErrorProducts,
  recordIssueHits,
  updateIssue,
} from './errors'
import { migrateToLatest } from './migrate'
import { createProject } from './projects'

const url = process.env.DATABASE_URL
const chUrl = process.env.CLICKHOUSE_URL
const org = '00000000-0000-4000-8000-0000000001e1'
const T0 = new Date('2026-11-28T10:00:00Z')
const user = '00000000-0000-4000-8000-0000000001e9'

function hit(projectId: string, fingerprint: string, at: Date, release = '', count = 1): IssueHit {
  return {
    org_id: org,
    project_id: projectId,
    fingerprint,
    type: 'TypeError',
    value: 'boom',
    culprit: 'f in a.js',
    platform: 'javascript',
    level: 'error',
    handled: true,
    first: at,
    last: at,
    count,
    releases: release ? [release] : [],
    firstRelease: release,
    lastRelease: release,
  }
}

const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)

describe.skipIf(!url)('error issues (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })
  let product = ''

  beforeAll(async () => {
    await migrateToLatest(db)
    await db.deleteFrom('project').where('org_id', '=', org).execute()
    product = (await createProject(db, org, { name: 'Errors Shop' })).id
  })
  afterAll(async () => {
    await db.deleteFrom('project').where('org_id', '=', org).execute()
    await pool.end()
  })

  const record = async (h: IssueHit, now = h.last, people = 0) =>
    (await recordIssueHits(db, [h], now, async () => people)).get(
      `${h.project_id}:${h.fingerprint}`,
    )

  it('creates an issue once and counts what comes after', async () => {
    const first = await record(hit(product, 'fp-a', T0, 'v1', 3))
    expect(first?.outcome).toBe('new')
    const again = await record(hit(product, 'fp-a', later(1), 'v2'))
    expect(again).toEqual({ id: first?.id, outcome: 'seen' })
    const issue = await getIssue(db, org, first?.id ?? '')
    expect(issue).toMatchObject({
      times_seen: 4,
      first_release: 'v1',
      last_release: 'v2',
      status: 'unresolved',
    })
    expect(issue?.last_seen.toISOString()).toBe(later(1).toISOString())
  })

  it('brings back a resolved issue with the next event', async () => {
    const { id } = (await record(hit(product, 'fp-b', T0, 'v1'))) ?? { id: '' }
    expect(await updateIssue(db, org, id, null as unknown as string, { kind: 'resolve' })).toBe(
      true,
    )
    expect((await record(hit(product, 'fp-b', later(5), 'v1')))?.outcome).toBe('regressed')
    const issue = await getIssue(db, org, id)
    expect(issue?.status).toBe('unresolved')
    expect(issue?.regressed_at).toBeInstanceOf(Date)
  })

  it('resolved in next release ignores the same release and comes back with a new one', async () => {
    const { id } = (await record(hit(product, 'fp-c', T0, 'v1'))) ?? { id: '' }
    await updateIssue(db, org, id, null as unknown as string, { kind: 'resolveInNextRelease' })
    expect((await getIssue(db, org, id))?.resolved_release).toBe('v1')
    expect((await record(hit(product, 'fp-c', later(1), 'v1')))?.outcome).toBe('seen')
    expect((await record(hit(product, 'fp-c', later(2))))?.outcome).toBe('seen')
    expect((await getIssue(db, org, id))?.status).toBe('resolved')
    expect((await record(hit(product, 'fp-c', later(3), 'v2')))?.outcome).toBe('regressed')
  })

  it('an ignored issue comes back when its condition is met', async () => {
    const { id } = (await record(hit(product, 'fp-d', T0))) ?? { id: '' }
    await updateIssue(db, org, id, null as unknown as string, {
      kind: 'ignore',
      until: { count: 5 },
    })
    expect((await record(hit(product, 'fp-d', later(1), '', 4)))?.outcome).toBe('seen')
    expect((await getIssue(db, org, id))?.status).toBe('ignored')
    expect((await record(hit(product, 'fp-d', later(2))))?.outcome).toBe('regressed')

    await updateIssue(db, org, id, null as unknown as string, {
      kind: 'ignore',
      until: { people: 10 },
    })
    expect((await record(hit(product, 'fp-d', later(3)), later(3), 9))?.outcome).toBe('seen')
    expect((await record(hit(product, 'fp-d', later(4)), later(4), 10))?.outcome).toBe('regressed')

    await updateIssue(db, org, id, null as unknown as string, { kind: 'ignore', until: null })
    expect((await record(hit(product, 'fp-d', later(60 * 24 * 365), '', 1000)))?.outcome).toBe(
      'seen',
    )
  })

  it('lists issues by status, newest first', async () => {
    const base = { projectIds: [product], since: T0, userId: user }
    const unresolved = await listIssues(db, org, { ...base, tab: 'unresolved' })
    expect(unresolved.length).toBeGreaterThan(0)
    expect(unresolved.every((issue) => issue.status === 'unresolved')).toBe(true)
    const first = unresolved[0]
    expect(first?.last_seen.getTime()).toBeGreaterThanOrEqual(
      unresolved.at(-1)?.last_seen.getTime() ?? 0,
    )
    await updateIssue(db, org, first?.id ?? '', user, { kind: 'take' })
    expect((await listIssues(db, org, { ...base, tab: 'mine' })).map((i) => i.id)).toEqual([
      first?.id,
    ])
    const counts = await countIssues(db, org, [product], T0, user)
    expect(counts.mine).toBe(1)
    expect(counts.unresolved).toBe(unresolved.length)
    expect(counts.regressed).toBeGreaterThan(0)
    expect(await countNewIssues(db, org, [product], T0, later(1))).toBe(4)
    expect(await listIssues(db, org, { ...base, projectIds: [], tab: 'new' })).toEqual([])
    expect(await recentErrorProducts(db, T0)).toContainEqual({ orgId: org, projectId: product })
  })

  it('names the last issue of each product, and none for a product without errors', async () => {
    const quiet = (await createProject(db, org, { name: 'Quiet Shop' })).id
    const last = await lastIssues(db, org, [product, quiet])
    expect(last.has(quiet)).toBe(false)
    const top = await db
      .selectFrom('error_issue')
      .select((eb) => eb.fn.max('last_seen').as('at'))
      .where('project_id', '=', product)
      .executeTakeFirstOrThrow()
    expect(last.get(product)?.lastSeen.toISOString()).toBe(new Date(top.at).toISOString())
    expect(await lastIssues(db, org, [])).toEqual(new Map())
  })
})

describe.skipIf(!chUrl)('error events (needs CLICKHOUSE_URL)', () => {
  const client = createClickHouse(chUrl ?? '')
  const project = '00000000-0000-4000-8000-0000000001e2'
  const issue = '00000000-0000-4000-8000-0000000001e3'
  const other = '00000000-0000-4000-8000-0000000001e4'
  const row = (
    minutes: number,
    person: string,
    browser: string,
    n: number,
    issueId = issue,
  ): ErrorRow => ({
    org_id: org,
    project_id: project,
    source_id: '00000000-0000-0000-0000-000000000000',
    issue_id: issueId,
    event_id: n.toString(16).padStart(32, '0'),
    fingerprint: 'fp',
    timestamp: later(minutes).toISOString().replace('T', ' ').replace('Z', ''),
    received_at: later(minutes).toISOString().replace('T', ' ').replace('Z', ''),
    type: 'TypeError',
    value: 'boom',
    level: 'error',
    handled: 1,
    platform: 'javascript',
    sdk: 'sentry.javascript.browser',
    release: 'v1',
    environment: 'production',
    culprit: 'f in a.js',
    url: 'https://shop.example/checkout',
    path: '/checkout',
    browser,
    os: 'macOS',
    country: 'BR',
    person,
    exception: JSON.stringify([{ type: 'TypeError', value: 'boom', frames: [] }]),
    breadcrumbs: '[]',
    tags: '{"a":"b"}',
    trace_id: '',
  })

  beforeAll(async () => {
    await migrateClickHouse(chUrl ?? '')
    await client.command({ query: `DELETE FROM errors WHERE org_id = '${org}'` })
    await insertErrors(
      client,
      [
        row(1, 'u1', 'Safari', 1),
        row(2, 'u1', 'Safari', 2),
        row(30, 'u2', 'Chrome', 3),
        row(90, '', 'Safari', 4),
        // Another issue: once the day before at the same time, twice now.
        row(31 - 1440, 'u3', 'Safari', 5, other),
        row(25, 'u3', 'Safari', 6, other),
        row(26, 'u3', 'Safari', 7, other),
        // A new token each run: the table drops a block it has already seen.
      ],
      crypto.randomUUID(),
    )
  })
  afterAll(async () => {
    await client.close()
  })

  const scope = { orgId: org, projectIds: [project], from: T0, to: later(120) }

  it('counts events, issues and people, and draws the series', async () => {
    const one = { ...scope, from: later(-1), to: later(24) }
    expect(await errorTotals(client, one)).toEqual({ events: 2, issues: 1, people: 1 })
    expect(await errorTotals(client, scope)).toEqual({ events: 6, issues: 2, people: 3 })
    expect((await errorsByProduct(client, scope)).get(project)).toEqual({ events: 6, issues: 2 })
    const series = await errorSeries(client, scope, 'hour')
    expect(series.map((p) => [p.events, p.people])).toEqual([
      [5, 3],
      [1, 0],
    ])
    expect(await issuePeople(client, issue, later(10))).toBe(1)
  })

  it('reads issue stats, who it hits and one event', async () => {
    const stats = (await issueStats(client, scope, 4)).get(issue)
    expect(stats).toEqual({
      events: 4,
      people: 2,
      source: '00000000-0000-0000-0000-000000000000',
      spark: [2, 1, 0, 1],
    })
    const facets = await issueFacets(client, scope, issue, ['browser'])
    expect(facets.browser[0]).toMatchObject({ value: 'Safari', events: 3, share: 0.75 })
    const newest = await issueEvent(client, org, issue)
    expect(newest?.event_id).toBe((4).toString(16).padStart(32, '0'))
    expect(newest?.previous).toBe((3).toString(16).padStart(32, '0'))
    expect(newest?.tags).toEqual({ a: 'b' })
    const named = await issueEvent(client, org, issue, (1).toString(16).padStart(32, '0'))
    expect(named?.previous).toBeNull()
  })

  it('reads the error rate against the same time on the days before', async () => {
    const products = [{ orgId: org, projectId: project }]
    const [rate] = await errorRates(client, products, later(31), 15)
    expect(rate).toMatchObject({
      count: 3,
      top: [
        { issueId: other, count: 2 },
        { issueId: issue, count: 1 },
      ],
    })
    expect(rate?.normal).toBeCloseTo(1 / 7 / 4)
    const [skipped] = await errorRates(client, products, later(31), 15, [other])
    expect(skipped).toMatchObject({ count: 1, normal: 0, top: [{ issueId: issue, count: 1 }] })
  })
})
