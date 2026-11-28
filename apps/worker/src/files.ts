import type { Logger } from '@octadash/core'
import {
  DROPPED_PREFIX,
  type FileUsage,
  NO_SOURCE,
  type ReceivedRow,
  toClickHouseTime,
} from '@octadash/db'
import type { StorageStatus } from '@octadash/queue'
import { dayOfFolder, deletePrefix, FILES_PREFIX, type FileStore } from '@octadash/storage'
import type { PgBoss } from 'pg-boss'

/**
 * Upkeep of file storage, run every hour: files older than the retention go
 * (by whole days, the first folder of every key), and past the size limit the
 * oldest days go first, each removal counted in `received` as a `dropped:` row
 * per product, so the panel can say what was lost and why. The result is the
 * status the panel shows.
 */
export interface FileSweepDeps {
  /** Undefined: no STORAGE_* set. */
  store: FileStore | undefined
  host: string | null
  /** Same as the `received` rows that point to the files. */
  retentionDays: number
  /** 0: no limit. */
  limitBytes: number
  usage: (days: string[]) => Promise<FileUsage[]>
  insertDropped: (rows: ReceivedRow[]) => Promise<void>
  previous: () => Promise<StorageStatus | null>
  now: () => number
  log: Logger
}

const DAY_MS = 24 * 3600 * 1000
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export const FILE_QUEUE = 'file-storage'

export async function registerFileJobs(
  boss: PgBoss,
  deps: FileSweepDeps,
  write: (status: StorageStatus) => Promise<void>,
) {
  const run = async () => write(await sweepFiles(deps))
  await boss.createQueue(FILE_QUEUE, { policy: 'exclusive', expireInSeconds: 3600 })
  await boss.schedule(FILE_QUEUE, '41 * * * *')
  await boss.work(FILE_QUEUE, run)
  // Once at start, so the panel knows at once whether storage answers.
  await boss.send(FILE_QUEUE, {})
}

export async function sweepFiles(deps: FileSweepDeps): Promise<StorageStatus> {
  const now = deps.now()
  const previous = await deps.previous().catch(() => null)
  const base = {
    checkedAt: new Date(now).toISOString(),
    host: deps.host,
    limitBytes: deps.limitBytes,
    retentionDays: deps.retentionDays,
    trimmed: previous?.trimmed ?? null,
  }
  const { store } = deps
  if (!store) {
    return { ...base, configured: false, ok: false, error: null, usedBytes: 0 }
  }
  try {
    await store.check()
    const days = (await store.folders(FILES_PREFIX))
      .map((folder) => dayOfFolder(folder))
      .filter((day): day is string => day !== undefined)
      .sort()
    // The day the oldest kept rows arrived; files from before it have no row left.
    const cutoff = dayOf(now - deps.retentionDays * DAY_MS)
    for (const day of days.filter((d) => d < cutoff)) {
      const removed = await deletePrefix(store, `${FILES_PREFIX}${day}/`)
      deps.log.info({ day, files: removed.count }, 'files past retention removed')
    }
    const kept = days.filter((d) => d >= cutoff)
    const usage = await deps.usage(kept)
    const perDay = new Map<string, FileUsage[]>()
    for (const row of usage) perDay.set(row.day, [...(perDay.get(row.day) ?? []), row])
    let used = usage.reduce((sum, row) => sum + row.bytes, 0)
    let trimmed = base.trimmed
    // Today's files are never removed for the limit: they are what is arriving.
    const today = dayOf(now)
    for (const day of kept) {
      if (deps.limitBytes === 0 || used <= deps.limitBytes || day >= today) break
      const removed = await deletePrefix(store, `${FILES_PREFIX}${day}/`)
      const rows = perDay.get(day) ?? []
      used -= rows.reduce((sum, row) => sum + row.bytes, 0)
      const at = toClickHouseTime(new Date(now))
      await deps.insertDropped(
        rows.map((row) => ({
          org_id: row.org_id,
          project_id: row.project_id,
          source_id: NO_SOURCE,
          kind: `${DROPPED_PREFIX}file`,
          timestamp: at,
          received_at: at,
          payload: JSON.stringify({ reason: 'storage_limit', count: row.files, day }),
          encoding: 'json',
          bytes: Math.min(row.bytes, 4_294_967_295),
          masked: 0,
          retention_days: deps.retentionDays,
        })),
      )
      trimmed = { day, at: new Date(now).toISOString(), files: removed.count }
      deps.log.warn(
        { day, files: removed.count, limitBytes: deps.limitBytes },
        'file storage over its limit: oldest day removed',
      )
    }
    return {
      ...base,
      trimmed,
      configured: true,
      ok: true,
      error: null,
      usedBytes: Math.max(0, used),
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    deps.log.error({ err: error }, 'file storage sweep failed')
    return {
      ...base,
      configured: true,
      ok: false,
      error: error.slice(0, 500),
      usedBytes: previous?.usedBytes ?? 0,
    }
  }
}
