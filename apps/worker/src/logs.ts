import type { Logger } from '@octadash/core'
import { DEFAULT_LOG_RETENTION_DAYS, type LogRow, type QueuedLog } from '@octadash/db'
import { cachedRetention } from './retention'
import type { EventRouter } from './routing'

export interface LogWriterDeps {
  router: EventRouter
  loadRetention(projectIds: string[]): Promise<Map<string, number>>
  insert(rows: LogRow[], token: string): Promise<void>
  log: Logger
  now?: () => number
}

/**
 * Writes a batch of log lines: drops those of products that switched Logs
 * off, and stamps each line with its product's retention, which the table's
 * TTL reads.
 */
export function createLogWriter(deps: LogWriterDeps) {
  const retentionOf = cachedRetention(deps.loadRetention, DEFAULT_LOG_RETENTION_DAYS, deps.now)
  return async (rows: QueuedLog[], token: string) => {
    const kept = await deps.router.route(rows, () => 'logs')
    if (kept.length === 0) return
    const days = await retentionOf(kept.map((row) => row.project_id))
    const written = kept.map((row) => ({
      ...row,
      retention_days: days.get(row.project_id) ?? DEFAULT_LOG_RETENTION_DAYS,
    }))
    await deps.insert(written, token)
    deps.log.debug({ rows: written.length, discarded: rows.length - kept.length }, 'logs written')
  }
}
