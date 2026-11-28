import type { Redis } from 'ioredis'

const KEY = 'octadash:storage:status'

/**
 * How file storage is doing, written by the worker after each sweep and read
 * by the panel: whether the bucket answers, how much it holds against the
 * limit, and when the oldest files last had to go to stay under it.
 */
export interface StorageStatus {
  checkedAt: string
  /** False: no STORAGE_* set, so files over 1 MB are counted, not kept. */
  configured: boolean
  ok: boolean
  error: string | null
  /** Host of the bucket's address (`garage:3900`, `<account>.r2.cloudflarestorage.com`). */
  host: string | null
  usedBytes: number
  /** 0: no limit. */
  limitBytes: number
  /** Days files are kept, the same as the other received data. */
  retentionDays: number
  /** The last time the oldest day was removed because of the limit. */
  trimmed: { day: string; at: string; files: number } | null
}

export interface StorageStatusStore {
  read(): Promise<StorageStatus | null>
  write(status: StorageStatus): Promise<void>
}

export class ValkeyStorageStatus implements StorageStatusStore {
  constructor(private readonly redis: Redis) {}

  async read() {
    const raw = await this.redis.get(KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as StorageStatus
    } catch {
      return null
    }
  }

  async write(status: StorageStatus) {
    await this.redis.set(KEY, JSON.stringify(status))
  }
}

export class MemoryStorageStatus implements StorageStatusStore {
  status: StorageStatus | null = null

  async read() {
    return this.status
  }

  async write(status: StorageStatus) {
    this.status = status
  }
}
