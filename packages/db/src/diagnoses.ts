import { uuidv7 } from '@octadash/core'
import type { DiagnosisReport } from '@octadash/diagnosis'
import { sql } from 'kysely'
import type { Db } from './client'
import type { DiagnosisTrigger } from './schema'

/** Channel the worker listens on; the payload is the diagnosis id. */
export const DIAGNOSIS_CHANNEL = 'octadash_diagnosis'
/** A diagnosis stuck in "running" this long is given back to the queue. */
export const DIAGNOSIS_STALE_MINUTES = 5
export const DIAGNOSIS_MAX_ATTEMPTS = 3

/**
 * Queues a diagnosis of the product's current address and wakes the worker.
 * Returns the pending one instead when the product already has one waiting, and
 * null when the product has no address.
 */
export async function requestDiagnosis(
  db: Db,
  orgId: string,
  projectId: string,
  trigger: DiagnosisTrigger,
) {
  return db.transaction().execute(async (trx) => {
    const project = await trx
      .selectFrom('project')
      .select(['id', 'url'])
      .where('org_id', '=', orgId)
      .where('id', '=', projectId)
      .forUpdate()
      .executeTakeFirst()
    if (!project?.url) return null
    const pending = await trx
      .selectFrom('diagnosis')
      .selectAll()
      .where('project_id', '=', projectId)
      .where('status', 'in', ['queued', 'running'])
      .where('url', '=', project.url)
      .executeTakeFirst()
    if (pending) return pending
    const row = await trx
      .insertInto('diagnosis')
      .values({ id: uuidv7(), org_id: orgId, project_id: projectId, url: project.url, trigger })
      .returningAll()
      .executeTakeFirstOrThrow()
    await sql`select pg_notify(${DIAGNOSIS_CHANNEL}, ${row.id})`.execute(trx)
    return row
  })
}

/** The product's diagnosis in progress, if any, and its last finished one. */
export async function getDiagnosisState(db: Db, orgId: string, projectId: string) {
  const [pending, last] = await Promise.all([
    db
      .selectFrom('diagnosis')
      .select(['id', 'status', 'url', 'created_at', 'started_at'])
      .where('org_id', '=', orgId)
      .where('project_id', '=', projectId)
      .where('status', 'in', ['queued', 'running'])
      .orderBy('created_at', 'desc')
      .executeTakeFirst(),
    db
      .selectFrom('diagnosis')
      .selectAll()
      .where('org_id', '=', orgId)
      .where('project_id', '=', projectId)
      .where('status', 'in', ['done', 'failed'])
      .orderBy('finished_at', 'desc')
      .executeTakeFirst(),
  ])
  return { pending: pending ?? null, last: last ?? null }
}

/** The last finished report of each product of the organization, for the "All" tab. */
export async function latestReportsForOrg(db: Db, orgId: string) {
  const rows = await db
    .selectFrom('diagnosis')
    .select(['project_id', 'report', 'finished_at'])
    .distinctOn('project_id')
    .where('org_id', '=', orgId)
    .where('status', '=', 'done')
    .orderBy('project_id')
    .orderBy('finished_at', 'desc')
    .execute()
  return new Map(rows.map((row) => [row.project_id, row]))
}

/** Products with a diagnosis queued or running, so the panel can show progress. */
export async function pendingProjectsForOrg(db: Db, orgId: string) {
  const rows = await db
    .selectFrom('diagnosis')
    .select('project_id')
    .distinct()
    .where('org_id', '=', orgId)
    .where('status', 'in', ['queued', 'running'])
    .execute()
  return new Set(rows.map((row) => row.project_id))
}

/** Takes the oldest queued diagnosis. Safe with several workers (SKIP LOCKED). */
export async function claimNextDiagnosis(db: Db) {
  return db
    .updateTable('diagnosis')
    .set({ status: 'running', started_at: new Date(), attempts: sql`attempts + 1` })
    .where(
      'id',
      '=',
      db
        .selectFrom('diagnosis')
        .select('id')
        .where('status', '=', 'queued')
        .orderBy('created_at')
        .limit(1)
        .forUpdate()
        .skipLocked(),
    )
    .returning(['id', 'org_id', 'project_id', 'url', 'attempts'])
    .executeTakeFirst()
}

export async function completeDiagnosis(db: Db, id: string, report: DiagnosisReport) {
  await db
    .updateTable('diagnosis')
    .set({ status: 'done', report, error: null, finished_at: new Date() })
    .where('id', '=', id)
    .execute()
}

export async function failDiagnosis(db: Db, id: string, error: string) {
  await db
    .updateTable('diagnosis')
    .set({ status: 'failed', error: error.slice(0, 500), finished_at: new Date() })
    .where('id', '=', id)
    .execute()
}

/**
 * Gives diagnoses left "running" by a worker that died back to the queue, or
 * fails them after the last attempt. Returns how many went back.
 */
export async function recoverStaleDiagnoses(db: Db) {
  const cutoff = sql<Date>`now() - make_interval(mins => ${DIAGNOSIS_STALE_MINUTES})`
  await db
    .updateTable('diagnosis')
    .set({ status: 'failed', error: 'worker stopped', finished_at: new Date() })
    .where('status', '=', 'running')
    .where('started_at', '<', cutoff)
    .where('attempts', '>=', DIAGNOSIS_MAX_ATTEMPTS)
    .execute()
  const result = await db
    .updateTable('diagnosis')
    .set({ status: 'queued', started_at: null })
    .where('status', '=', 'running')
    .where('started_at', '<', cutoff)
    .executeTakeFirst()
  return Number(result.numUpdatedRows)
}

/**
 * Queues the daily diagnosis of every product with an address whose last one is
 * older than `hours`. One statement for all organizations; returns how many.
 */
export async function enqueueDueDiagnoses(db: Db, hours = 24) {
  const result = await sql<{ id: string }>`
    insert into diagnosis (id, org_id, project_id, url, trigger)
    select gen_random_uuid(), p.org_id, p.id, p.url, 'schedule'
    from project p
    where p.url is not null
      and not exists (
        select 1 from diagnosis d
        where d.project_id = p.id
          and (d.status in ('queued', 'running')
               or d.created_at > now() - make_interval(hours => ${hours}))
      )
    returning id`.execute(db)
  if (result.rows.length > 0) {
    await sql`select pg_notify(${DIAGNOSIS_CHANNEL}, 'batch')`.execute(db)
  }
  return result.rows.length
}

/** Deletes diagnoses older than `days`, keeping the last finished one of each product. */
export async function pruneDiagnoses(db: Db, days = 90) {
  const result = await sql`
    delete from diagnosis d
    where d.created_at < now() - make_interval(days => ${days})
      and d.id not in (
        select distinct on (project_id) id from diagnosis
        where status = 'done'
        order by project_id, finished_at desc
      )`.execute(db)
  return Number(result.numAffectedRows ?? 0)
}
