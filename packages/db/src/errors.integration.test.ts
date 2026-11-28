import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClickHouse } from './clickhouse/client'
import {
  type ErrorRow,
  errorSeries,
  errorTotals,
  insertErrors,
  issueEvent,
  issueFacets,
  issuePeople,
  issueStats,
} from './clickhouse/errors'
import { migrateClickHouse } from './clickhouse/migrate'
import { createDb } from './client'
import { getIssue, type IssueHit, listIssues, recordIssueHits, updateIssue } from './errors'
import { migrateToLatest } from './migrate'
import { createProject } from './projects'

const url = process.env.DATABASE_URL
const chUrl = process.env.CLICKHOUSE_URL
const org = '00000000-0000-4000-8000-0000000001e1'
const T0 = new Date('2026-11-28T10:00:00Z')

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
    const unresolved = await listIssues(db, org, { projectIds: [product], status: 'unresolved' })
    expect(unresolved.length).toBeGreaterThan(0)
    expect(unresolved.every((issue) => issue.status === 'unresolved')).toBe(true)
    const all = await listIssues(db, org, { projectIds: [product] })
    expect(all[0]?.last_seen.getTime()).toBeGreaterThanOrEqual(all.at(-1)?.last_seen.getTime() ?? 0)
    expect(await listIssues(db, org, { projectIds: [] })).toEqual([])
  })
})

describe.skipIf(!chUrl)('error events (needs CLICKHOUSE_URL)', () => {
  const client = createClickHouse(chUrl ?? '')
  const project = '00000000-0000-4000-8000-0000000001e2'
  const issue = '00000000-0000-4000-8000-0000000001e3'
  const row = (minutes: number, person: string, browser: string, n: number): ErrorRow => ({
    org_id: org,
    project_id: project,
    source_id: '00000000-0000-0000-0000-000000000000',
    issue_id: issue,
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
    expect(await errorTotals(client, scope)).toEqual({ events: 4, issues: 1, people: 2 })
    const series = await errorSeries(client, scope, 'hour')
    expect(series.map((p) => p.events)).toEqual([3, 1])
    expect(await issuePeople(client, issue, later(10))).toBe(1)
  })

  it('reads issue stats, who it hits and one event', async () => {
    const stats = (await issueStats(client, scope, 4)).get(issue)
    expect(stats).toEqual({ events: 4, people: 2, spark: [2, 1, 0, 1] })
    const facets = await issueFacets(client, scope, issue, ['browser'])
    expect(facets.browser[0]).toMatchObject({ value: 'Safari', events: 3, share: 0.75 })
    const newest = await issueEvent(client, org, issue)
    expect(newest?.event_id).toBe((4).toString(16).padStart(32, '0'))
    expect(newest?.previous).toBe((3).toString(16).padStart(32, '0'))
    expect(newest?.tags).toEqual({ a: 'b' })
    const named = await issueEvent(client, org, issue, (1).toString(16).padStart(32, '0'))
    expect(named?.previous).toBeNull()
  })
})
