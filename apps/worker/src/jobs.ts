import type { Logger } from '@octadash/core'
import type { PgBoss } from 'pg-boss'

export const QUEUES = {
  /** Creates upcoming daily partitions and drops expired ones. */
  maintenance: 'maintenance',
} as const

/** Registers queues, schedules and handlers. Each module adds its own here. */
export async function registerJobs(boss: PgBoss, log: Logger): Promise<void> {
  await boss.createQueue(QUEUES.maintenance)
  await boss.schedule(QUEUES.maintenance, '17 * * * *')
  await boss.work(QUEUES.maintenance, async () => {
    // Partitioned tables arrive with the first data modules; nothing to maintain yet.
    log.debug('maintenance tick')
  })
}
