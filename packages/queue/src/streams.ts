import { Redis } from 'ioredis'

/**
 * One Valkey stream per kind of incoming data. The ingest appends, the worker
 * reads in a consumer group and deletes what it has written to ClickHouse.
 * Kinds arrive with their areas (errors, logs...).
 */
export const STREAMS = {
  events: 'octadash:ingest:events',
  errors: 'octadash:ingest:errors',
  logs: 'octadash:ingest:logs',
} as const

export type StreamKind = keyof typeof STREAMS

/** Field that holds the JSON payload of a stream entry. */
export const PAYLOAD_FIELD = 'b'

/** Consumer group shared by every worker, so several workers split the stream. */
export const WRITERS_GROUP = 'writers'

export interface ValkeyOptions {
  /** Shown in CLIENT LIST, useful to tell ingest and worker apart. */
  name: string
  /**
   * Fail commands at once while disconnected instead of queueing them. The
   * ingest wants this: it answers 503 and the SDK retries, rather than holding
   * the request open.
   */
  failFast?: boolean
}

export function createValkey(url: string, options: ValkeyOptions): Redis {
  return new Redis(url, {
    connectionName: options.name,
    // Blocking reads (XREADGROUP BLOCK) must not count as a failed request.
    maxRetriesPerRequest: options.failFast ? 1 : null,
    enableOfflineQueue: !options.failFast,
    retryStrategy: (times) => Math.min(times * 500, 5_000),
  })
}

export type { Redis }
