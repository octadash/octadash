import type { Logger } from '@octadash/core'
import type { Db } from '@octadash/db'
import type { PgBoss } from 'pg-boss'

export const QUEUES = {
  /** Hourly upkeep. Retention and rollups join it as the areas arrive. */
  maintenance: 'maintenance',
} as const

/** Queues from earlier versions. Their schedules are removed so no job piles up unread. */
const RETIRED_QUEUES = ['diagnosis-schedule']

/** Registers queues, schedules and handlers. Each module adds its own here. */
export async function registerJobs(boss: PgBoss, _db: Db, log: Logger): Promise<void> {
  for (const name of RETIRED_QUEUES) {
    if (await boss.getQueue(name)) {
      await boss.unschedule(name)
      await boss.deleteQueue(name)
    }
  }

  await boss.createQueue(QUEUES.maintenance)
  await boss.schedule(QUEUES.maintenance, '17 * * * *')
  await boss.work(QUEUES.maintenance, async () => {
    log.debug('maintenance tick')
  })
}
