import type { StorageStatus } from '@octadash/queue'

/** How full is "almost full": the panel warns from here on. */
export const STORAGE_WARN_RATIO = 0.9
/** A removal for the limit is shown for this long. */
export const TRIMMED_SHOW_MS = 7 * 24 * 3600 * 1000

export type StorageState = 'unknown' | 'off' | 'failing' | 'full' | 'trimmed' | 'ok'

/** What the panel says about file storage, from the worker's last look. */
export function storageState(status: StorageStatus | null, now: number): StorageState {
  if (!status) return 'unknown'
  if (!status.configured) return 'off'
  if (!status.ok) return 'failing'
  if (status.limitBytes > 0 && status.usedBytes >= status.limitBytes * STORAGE_WARN_RATIO) {
    return 'full'
  }
  if (status.trimmed && now - new Date(status.trimmed.at).getTime() < TRIMMED_SHOW_MS) {
    return 'trimmed'
  }
  return 'ok'
}

/** The bundled store answers at garage:3900 inside the compose. */
export function isBundled(host: string | null) {
  return host !== null && /^garage(:\d+)?$/.test(host)
}
