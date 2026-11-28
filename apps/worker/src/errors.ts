import type { Logger } from '@octadash/core'
import {
  type ErrorRow,
  hitKey,
  type IssueHit,
  type IssueOutcome,
  type QueuedError,
} from '@octadash/db'
import type { EventRouter } from './routing'

export interface ErrorWriterDeps {
  router: EventRouter
  recordHits(hits: IssueHit[]): Promise<Map<string, IssueOutcome>>
  insert(rows: ErrorRow[], token: string): Promise<void>
  /** Called with the products that got a new or returning issue, once per batch. */
  onChange(
    changes: {
      orgId: string
      projectId: string
      issueId: string
      outcome: IssueOutcome['outcome']
    }[],
  ): Promise<void>
  log: Logger
}

/** The events of a batch, one hit per product and fingerprint. */
export function groupHits(rows: QueuedError[]): IssueHit[] {
  const hits = new Map<string, IssueHit>()
  for (const row of [...rows].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    const key = hitKey(row.project_id, row.fingerprint)
    const at = new Date(`${row.timestamp.replace(' ', 'T')}Z`)
    const hit = hits.get(key)
    if (!hit) {
      hits.set(key, {
        org_id: row.org_id,
        project_id: row.project_id,
        fingerprint: row.fingerprint,
        type: row.type,
        value: row.value,
        culprit: row.culprit,
        platform: row.platform,
        level: row.level,
        handled: row.handled === 1,
        first: at,
        last: at,
        count: 1,
        releases: row.release ? [row.release] : [],
        firstRelease: row.release,
        lastRelease: row.release,
      })
      continue
    }
    hit.count++
    hit.last = at
    hit.value = row.value
    // An unhandled event makes the issue unhandled.
    if (row.handled === 0) hit.handled = false
    if (row.release) {
      if (!hit.releases.includes(row.release)) hit.releases.push(row.release)
      if (!hit.firstRelease) hit.firstRelease = row.release
      hit.lastRelease = row.release
    }
  }
  return [...hits.values()]
}

/**
 * Writes a batch of error events: drops those of products that switched
 * Errors off, finds or creates each issue, then stores every event in
 * ClickHouse with its issue's id. A retried batch counts its events in
 * `times_seen` again; the count on screen comes from ClickHouse, which
 * deduplicates the insert.
 */
export async function writeErrors(rows: QueuedError[], token: string, deps: ErrorWriterDeps) {
  const kept = await deps.router.route(rows, () => 'errors')
  if (kept.length === 0) return
  const hits = groupHits(kept)
  const outcomes = await deps.recordHits(hits)
  const written: ErrorRow[] = []
  for (const row of kept) {
    const issue = outcomes.get(hitKey(row.project_id, row.fingerprint))
    if (issue) written.push({ ...row, issue_id: issue.id })
  }
  await deps.insert(written, token)
  const changes = hits.flatMap((hit) => {
    const issue = outcomes.get(hitKey(hit.project_id, hit.fingerprint))
    return issue && issue.outcome !== 'seen'
      ? [
          {
            orgId: hit.org_id,
            projectId: hit.project_id,
            issueId: issue.id,
            outcome: issue.outcome,
          },
        ]
      : []
  })
  if (changes.length > 0) await deps.onChange(changes)
  deps.log.debug({ rows: written.length, discarded: rows.length - kept.length }, 'errors written')
}
