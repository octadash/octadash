import type { Db } from './client'
import type { WatcherStatus } from './schema'

/** The outside watcher of this install: one row, shared by every organization. */
export function getWatcher(db: Db) {
  return db
    .selectFrom('octadash_instance')
    .select(['watcher_url', 'watcher_status', 'watcher_checked_at', 'watcher_error'])
    .orderBy('created_at')
    .limit(1)
    .executeTakeFirst()
}

/** Saves (or clears) the encrypted ping URL. The status starts over. */
export async function setWatcherUrl(db: Db, encryptedUrl: string | null) {
  await db
    .updateTable('octadash_instance')
    .set({
      watcher_url: encryptedUrl,
      watcher_status: 'unknown',
      watcher_checked_at: null,
      watcher_error: null,
    })
    .execute()
}

/** Records the result of a ping. */
export async function recordWatcherPing(
  db: Db,
  status: Exclude<WatcherStatus, 'unknown'>,
  error: string | null,
  at: Date,
) {
  await db
    .updateTable('octadash_instance')
    .set({ watcher_status: status, watcher_checked_at: at, watcher_error: error })
    .where('watcher_url', 'is not', null)
    .execute()
}
