import { createLogger } from '@octadash/core'
import type { ErrorRow, IssueHit, QueuedError } from '@octadash/db'
import { describe, expect, it } from 'vitest'
import { groupHits, writeErrors } from './errors'
import { EventRouter } from './routing'

function error(project: string, fingerprint: string, at: string, release = ''): QueuedError {
  return {
    org_id: 'o',
    project_id: project,
    source_id: 's1',
    event_id: crypto.randomUUID().replaceAll('-', ''),
    fingerprint,
    timestamp: at,
    received_at: at,
    type: 'TypeError',
    value: `boom at ${at}`,
    level: 'error',
    handled: 1,
    platform: 'javascript',
    sdk: '',
    release,
    environment: '',
    culprit: 'f in a.js',
    url: '',
    path: '',
    browser: '',
    os: '',
    country: '',
    person: '',
    exception: '[]',
    breadcrumbs: '[]',
    tags: '{}',
    trace_id: '',
  }
}

describe('groupHits', () => {
  it('makes one hit per product and fingerprint, in time order', () => {
    const hits = groupHits([
      error('p1', 'a', '2026-11-28 12:00:02.000', 'v2'),
      error('p1', 'a', '2026-11-28 12:00:01.000', 'v1'),
      error('p2', 'a', '2026-11-28 12:00:00.000'),
      { ...error('p1', 'b', '2026-11-28 12:00:00.000'), handled: 0 },
    ])
    expect(hits).toHaveLength(3)
    const a = hits.find((h) => h.project_id === 'p1' && h.fingerprint === 'a')
    expect(a).toMatchObject({
      count: 2,
      releases: ['v1', 'v2'],
      firstRelease: 'v1',
      lastRelease: 'v2',
      value: 'boom at 2026-11-28 12:00:02.000',
    })
    expect(a?.first.toISOString()).toBe('2026-11-28T12:00:01.000Z')
    expect(hits.find((h) => h.fingerprint === 'b')?.handled).toBe(false)
  })
})

describe('writeErrors', () => {
  it('drops products with Errors off, stores the rest with their issue and reports new ones', async () => {
    const router = new EventRouter({
      loadDismissed: async (ids) =>
        new Map(ids.map((id) => [id, new Set(id === 'off' ? ['errors'] : [])])),
      recordDiscarded: async () => {},
      addSourceAreas: async () => {},
      now: () => 0,
    })
    const written: ErrorRow[] = []
    const changes: unknown[] = []
    await writeErrors(
      [error('p1', 'a', '2026-11-28 12:00:00.000'), error('off', 'a', '2026-11-28 12:00:00.000')],
      'token',
      {
        router,
        recordHits: async (hits: IssueHit[]) =>
          new Map(
            hits.map((h) => [
              `${h.project_id}:${h.fingerprint}`,
              { id: 'i1', outcome: 'new' as const },
            ]),
          ),
        insert: async (rows) => {
          written.push(...rows)
        },
        retentionOf: async (ids) => new Map(ids.map((id) => [id, 30])),
        onChange: async (list) => {
          changes.push(...list)
        },
        log: createLogger('test', 'silent'),
      },
    )
    expect(written.map((row) => [row.project_id, row.issue_id, row.retention_days])).toEqual([
      ['p1', 'i1', 30],
    ])
    expect(changes).toEqual([{ orgId: 'o', projectId: 'p1', issueId: 'i1', outcome: 'new' }])
  })
})
