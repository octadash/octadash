import type { Logger } from '@octadash/core'
import type { LogRow, QueuedLog } from '@octadash/db'
import type { EventRouter } from './routing'

/** A product's retention is read again after this long; a new choice reaches new lines within it. */
const RETENTION_TTL_MS = 60_000

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
  const now = deps.now ?? Date.now
  const retention = new Map<string, { days: number; expires: number }>()
  return async (rows: QueuedLog[], token: string) => {
    const kept = await deps.router.route(rows, () => 'logs')
    if (kept.length === 0) return
    const at = now()
    const stale = [...new Set(kept.map((row) => row.project_id))].filter(
      (id) => (retention.get(id)?.expires ?? 0) <= at,
    )
    if (stale.length > 0) {
      const fresh = await deps.loadRetention(stale)
      for (const id of stale) {
        retention.set(id, { days: fresh.get(id) ?? 14, expires: at + RETENTION_TTL_MS })
      }
    }
    const written = kept.map((row) => ({
      ...row,
      retention_days: retention.get(row.project_id)?.days ?? 14,
    }))
    await deps.insert(written, token)
    deps.log.debug({ rows: written.length, discarded: rows.length - kept.length }, 'logs written')
  }
}
