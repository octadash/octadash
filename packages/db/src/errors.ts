import { uuidv7 } from '@octadash/core'
import { sql } from 'kysely'
import type { Db } from './client'
import type { IgnoreUntil, IssueStatus } from './schema'

/**
 * Error issues (see migration 0019). The worker calls `recordIssueHits` for
 * every batch of error events: it finds or creates each issue and decides
 * whether it is new, came back (Regressed) or is one more event of a known
 * issue. The occurrences themselves go to ClickHouse.
 */

/** The events of one batch that share a product and a fingerprint. */
export interface IssueHit {
  org_id: string
  project_id: string
  fingerprint: string
  type: string
  value: string
  culprit: string
  platform: string
  level: string
  handled: boolean
  first: Date
  last: Date
  count: number
  /** Releases the events came from, without blanks; the first and last by time. */
  releases: string[]
  firstRelease: string
  lastRelease: string
}

export type HitOutcome = 'new' | 'regressed' | 'seen'

export interface IssueOutcome {
  id: string
  outcome: HitOutcome
}

export function hitKey(projectId: string, fingerprint: string): string {
  return `${projectId}:${fingerprint}`
}

/**
 * Records a batch. A resolved issue comes back when an event arrives, unless
 * it was resolved "in next release" and the event is from that same release
 * (or says no release). An ignored issue comes back when its condition is met;
 * `peopleSince` counts the people an issue hit since a time, for "ignore until
 * N more people".
 */
export async function recordIssueHits(
  db: Db,
  hits: IssueHit[],
  now: Date,
  peopleSince: (issueId: string, since: Date) => Promise<number> = async () => 0,
): Promise<Map<string, IssueOutcome>> {
  const out = new Map<string, IssueOutcome>()
  for (const hit of hits) {
    const result = await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('error_issue')
        .values({
          id: uuidv7(),
          org_id: hit.org_id,
          project_id: hit.project_id,
          fingerprint: hit.fingerprint,
          type: hit.type.slice(0, 200),
          value: hit.value.slice(0, 2000),
          culprit: hit.culprit,
          platform: hit.platform,
          level: hit.level,
          handled: hit.handled,
          first_seen: hit.first,
          last_seen: hit.last,
          first_release: hit.firstRelease,
          last_release: hit.lastRelease,
          times_seen: hit.count,
        })
        .onConflict((oc) => oc.columns(['project_id', 'fingerprint']).doNothing())
        .returning('id')
        .executeTakeFirst()
      if (created) return { id: created.id, outcome: 'new' as const }

      const issue = await trx
        .selectFrom('error_issue')
        .selectAll()
        .where('project_id', '=', hit.project_id)
        .where('fingerprint', '=', hit.fingerprint)
        .forUpdate()
        .executeTakeFirstOrThrow()
      const timesSeen = Number(issue.times_seen) + hit.count
      let status: IssueStatus = issue.status
      let comesBack = false
      if (issue.status === 'resolved') {
        comesBack =
          issue.resolved_release === null ||
          hit.releases.some((release) => release !== issue.resolved_release)
      } else if (issue.status === 'ignored' && issue.ignore_until) {
        const until = issue.ignore_until as IgnoreUntil
        const since = issue.status_at ?? issue.last_seen
        comesBack =
          (until.count !== undefined &&
            timesSeen - Number(issue.ignored_times_seen ?? issue.times_seen) >= until.count) ||
          (until.until !== undefined && now.getTime() >= until.until) ||
          (until.people !== undefined && (await peopleSince(issue.id, since)) >= until.people)
      }
      if (comesBack) status = 'unresolved'
      const newer = hit.last > issue.last_seen

      await trx
        .updateTable('error_issue')
        .set({
          times_seen: timesSeen,
          last_seen: newer ? hit.last : issue.last_seen,
          last_release: newer && hit.lastRelease ? hit.lastRelease : issue.last_release,
          value: newer ? hit.value.slice(0, 2000) : issue.value,
          status,
          ...(comesBack
            ? {
                status_at: now,
                status_by: null,
                regressed_at: now,
                resolved_release: null,
                ignore_until: null,
                ignored_times_seen: null,
                acknowledged_by: null,
                acknowledged_at: null,
              }
            : {}),
        })
        .where('id', '=', issue.id)
        .execute()
      return { id: issue.id, outcome: comesBack ? ('regressed' as const) : ('seen' as const) }
    })
    out.set(hitKey(hit.project_id, hit.fingerprint), result)
  }
  return out
}

export interface IssueRecord {
  id: string
  project_id: string
  fingerprint: string
  type: string
  value: string
  culprit: string
  platform: string
  level: string
  handled: boolean
  first_seen: Date
  last_seen: Date
  first_release: string
  last_release: string
  times_seen: number
  status: IssueStatus
  status_at: Date | null
  resolved_release: string | null
  ignore_until: IgnoreUntil | null
  regressed_at: Date | null
  acknowledged_at: Date | null
  acknowledged_by_name: string | null
}

const issueColumns = [
  'error_issue.id',
  'error_issue.project_id',
  'error_issue.fingerprint',
  'error_issue.type',
  'error_issue.value',
  'error_issue.culprit',
  'error_issue.platform',
  'error_issue.level',
  'error_issue.handled',
  'error_issue.first_seen',
  'error_issue.last_seen',
  'error_issue.first_release',
  'error_issue.last_release',
  'error_issue.times_seen',
  'error_issue.status',
  'error_issue.status_at',
  'error_issue.resolved_release',
  'error_issue.ignore_until',
  'error_issue.regressed_at',
  'error_issue.acknowledged_at',
] as const

function toRecord<
  T extends { times_seen: string; ignore_until: unknown; acknowledged_by_name: string | null },
>(row: T) {
  return {
    ...row,
    times_seen: Number(row.times_seen),
    ignore_until: (row.ignore_until as IgnoreUntil | null) ?? null,
  }
}

export interface IssueFilter {
  projectIds: string[]
  status?: IssueStatus
  /** Only issues seen at or after this time. */
  seenSince?: Date
  limit?: number
}

/** Issues of some products, most recently seen first. Counts for the period come from ClickHouse. */
export async function listIssues(
  db: Db,
  orgId: string,
  filter: IssueFilter,
): Promise<IssueRecord[]> {
  if (filter.projectIds.length === 0) return []
  let query = db
    .selectFrom('error_issue')
    .leftJoin('auth_user', 'auth_user.id', 'error_issue.acknowledged_by')
    .select([...issueColumns, 'auth_user.name as acknowledged_by_name'])
    .where('error_issue.org_id', '=', orgId)
    .where('error_issue.project_id', 'in', filter.projectIds)
  if (filter.status) query = query.where('error_issue.status', '=', filter.status)
  if (filter.seenSince) query = query.where('error_issue.last_seen', '>=', filter.seenSince)
  const rows = await query
    .orderBy('error_issue.last_seen', 'desc')
    .limit(filter.limit ?? 500)
    .execute()
  return rows.map(toRecord) as IssueRecord[]
}

export async function getIssue(
  db: Db,
  orgId: string,
  issueId: string,
): Promise<IssueRecord | null> {
  const row = await db
    .selectFrom('error_issue')
    .leftJoin('auth_user', 'auth_user.id', 'error_issue.acknowledged_by')
    .select([...issueColumns, 'auth_user.name as acknowledged_by_name'])
    .where('error_issue.org_id', '=', orgId)
    .where('error_issue.id', '=', issueId)
    .executeTakeFirst()
  return row ? (toRecord(row) as IssueRecord) : null
}

export type IssueAction =
  | { kind: 'resolve' }
  | { kind: 'resolveInNextRelease' }
  | { kind: 'ignore'; until: IgnoreUntil | null }
  | { kind: 'reopen' }
  | { kind: 'take' }
  | { kind: 'leave' }

/**
 * Changes an issue's status, or who is on it. "Resolve in next release"
 * remembers the release the issue was last seen in; with no release known it
 * is a plain Resolve.
 */
export async function updateIssue(
  db: Db,
  orgId: string,
  issueId: string,
  userId: string,
  action: IssueAction,
  now: Date = new Date(),
): Promise<boolean> {
  const base = db.updateTable('error_issue').where('org_id', '=', orgId).where('id', '=', issueId)
  const done = (r: { numUpdatedRows: bigint }) => r.numUpdatedRows > 0n
  const status = { status_at: now, status_by: userId, ignore_until: null, ignored_times_seen: null }
  switch (action.kind) {
    case 'resolve':
      return done(
        await base
          .set({ ...status, status: 'resolved', resolved_release: null })
          .executeTakeFirst(),
      )
    case 'resolveInNextRelease':
      return done(
        await base
          .set({
            ...status,
            status: 'resolved',
            resolved_release: sql<string | null>`nullif(last_release, '')`,
          })
          .executeTakeFirst(),
      )
    case 'ignore':
      return done(
        await base
          .set({
            ...status,
            status: 'ignored',
            resolved_release: null,
            ignore_until: action.until ? JSON.stringify(action.until) : null,
            ignored_times_seen: sql<string>`times_seen`,
          })
          .executeTakeFirst(),
      )
    case 'reopen':
      return done(
        await base
          .set({ ...status, status: 'unresolved', resolved_release: null })
          .executeTakeFirst(),
      )
    case 'take':
      return done(
        await base
          .set({ acknowledged_by: userId, acknowledged_at: now })
          .where('acknowledged_by', 'is', null)
          .executeTakeFirst(),
      )
    case 'leave':
      return done(
        await base
          .set({ acknowledged_by: null, acknowledged_at: null })
          .where('acknowledged_by', '=', userId)
          .executeTakeFirst(),
      )
  }
}
