import type { Logger } from '@octadash/core'
import { type Db, enqueueDueDiagnoses, pruneDiagnoses } from '@octadash/db'
import type { PgBoss } from 'pg-boss'

export const QUEUES = {
  /** Creates upcoming daily partitions and drops expired ones; prunes old rows. */
  maintenance: 'maintenance',
  /** Queues the daily diagnosis of every product (the runner does the visits). */
  diagnosisSchedule: 'diagnosis-schedule',
} as const

/** Registers queues, schedules and handlers. Each module adds its own here. */
export async function registerJobs(boss: PgBoss, db: Db, log: Logger): Promise<void> {
  await boss.createQueue(QUEUES.maintenance)
  await boss.schedule(QUEUES.maintenance, '17 * * * *')
  await boss.work(QUEUES.maintenance, async () => {
    const pruned = await pruneDiagnoses(db)
    log.debug({ pruned }, 'maintenance tick')
  })

  // Hourly, so a product is diagnosed about 24 hours after its last run
  // instead of every product at the same minute.
  await boss.createQueue(QUEUES.diagnosisSchedule)
  await boss.schedule(QUEUES.diagnosisSchedule, '41 * * * *')
  await boss.work(QUEUES.diagnosisSchedule, async () => {
    const queued = await enqueueDueDiagnoses(db)
    if (queued > 0) log.info({ queued }, 'daily diagnoses queued')
  })
}
