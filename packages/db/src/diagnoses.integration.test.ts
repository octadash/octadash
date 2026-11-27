import type { DiagnosisReport } from '@octadash/diagnosis'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from './client'
import {
  claimNextDiagnosis,
  completeDiagnosis,
  enqueueDueDiagnoses,
  failDiagnosis,
  getDiagnosisState,
  latestReportsForOrg,
  pendingProjectsForOrg,
  recoverStaleDiagnoses,
  requestDiagnosis,
} from './diagnoses'
import { migrateToLatest } from './migrate'
import { createProject } from './projects'

const url = process.env.DATABASE_URL
const orgA = '00000000-0000-4000-8000-0000000000d1'
const orgB = '00000000-0000-4000-8000-0000000000d2'

const report = { version: 1, url: 'https://a.example/', score: 2 } as DiagnosisReport

describe.skipIf(!url)('diagnoses (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 3 })

  beforeAll(async () => {
    await migrateToLatest(db)
    await db.deleteFrom('project').where('org_id', 'in', [orgA, orgB]).execute()
    // Leave no other queued rows around: claim order is global.
    await db.deleteFrom('diagnosis').where('status', 'in', ['queued', 'running']).execute()
  })
  afterAll(async () => {
    await db.deleteFrom('project').where('org_id', 'in', [orgA, orgB]).execute()
    await pool.end()
  })

  it('queues one diagnosis per product, notifies, and skips products without an address', async () => {
    const withUrl = await createProject(db, orgA, { name: 'Alpha', url: 'https://a.example' })
    const noUrl = await createProject(db, orgA, { name: 'Beta', url: null })

    const client = await pool.connect()
    const notes: string[] = []
    client.on('notification', (n) => notes.push(n.payload ?? ''))
    await client.query('listen octadash_diagnosis')

    const first = await requestDiagnosis(db, orgA, withUrl.id, 'created')
    const again = await requestDiagnosis(db, orgA, withUrl.id, 'manual')
    expect(again?.id).toBe(first?.id)
    expect(await requestDiagnosis(db, orgA, noUrl.id, 'manual')).toBeNull()
    expect(await requestDiagnosis(db, orgB, withUrl.id, 'manual')).toBeNull()

    await new Promise((r) => setTimeout(r, 100))
    expect(notes).toEqual([first?.id])
    client.release()

    expect(await pendingProjectsForOrg(db, orgA)).toEqual(new Set([withUrl.id]))
  })

  it('claims each diagnosis once and stores the report', async () => {
    const [a, b] = await Promise.all([claimNextDiagnosis(db), claimNextDiagnosis(db)])
    const claimed = [a, b].filter(Boolean)
    expect(claimed).toHaveLength(1)
    const job = claimed[0]
    if (!job) throw new Error('nothing claimed')
    expect(job.attempts).toBe(1)
    await completeDiagnosis(db, job.id, report)

    const state = await getDiagnosisState(db, orgA, job.project_id)
    expect(state.pending).toBeNull()
    expect(state.last?.status).toBe('done')
    expect(state.last?.report).toEqual(report)

    const reports = await latestReportsForOrg(db, orgA)
    expect(reports.get(job.project_id)?.report).toEqual(report)
    expect((await latestReportsForOrg(db, orgB)).size).toBe(0)
  })

  it('keeps the last report visible while a new one fails', async () => {
    const project = await db
      .selectFrom('project')
      .select('id')
      .where('org_id', '=', orgA)
      .where('name', '=', 'Alpha')
      .executeTakeFirstOrThrow()
    await requestDiagnosis(db, orgA, project.id, 'manual')
    const job = await claimNextDiagnosis(db)
    if (!job) throw new Error('nothing claimed')
    await failDiagnosis(db, job.id, 'boom')
    expect((await latestReportsForOrg(db, orgA)).get(project.id)?.report).toEqual(report)
  })

  it('returns stale running diagnoses to the queue', async () => {
    const project = await createProject(db, orgB, { name: 'Gamma', url: 'https://g.example' })
    await requestDiagnosis(db, orgB, project.id, 'created')
    const job = await claimNextDiagnosis(db)
    if (!job) throw new Error('nothing claimed')
    await sql`update diagnosis set started_at = now() - interval '10 minutes' where id = ${job.id}`.execute(
      db,
    )
    expect(await recoverStaleDiagnoses(db)).toBe(1)
    expect((await claimNextDiagnosis(db))?.id).toBe(job.id)
    await completeDiagnosis(db, job.id, report)
  })

  it('queues the daily run only for products not diagnosed recently', async () => {
    const fresh = await createProject(db, orgB, { name: 'Delta', url: 'https://d.example' })
    const queued = await enqueueDueDiagnoses(db)
    expect(queued).toBeGreaterThanOrEqual(1)
    const rows = await db
      .selectFrom('diagnosis')
      .select(['project_id', 'trigger'])
      .where('org_id', 'in', [orgA, orgB])
      .where('status', '=', 'queued')
      .execute()
    expect(rows).toEqual([{ project_id: fresh.id, trigger: 'schedule' }])
    expect(await enqueueDueDiagnoses(db)).toBe(0)
  })
})
