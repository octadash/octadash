import { hostname } from 'node:os'
import type { Logger } from '@octadash/core'
import type { Redis } from 'ioredis'
import { PAYLOAD_FIELD, STREAMS, type StreamKind, WRITERS_GROUP } from './streams'

/**
 * Receives one batch read from a stream. `token` is the same every time the
 * same entries are retried, so the writer can pass it to ClickHouse as an
 * insert deduplication token.
 */
export type BatchHandler = (rows: unknown[], token: string) => Promise<void>

export interface ConsumerOptions {
  log: Logger
  /** Entries read per round. Each entry is one request's batch of rows. */
  count?: number
  blockMs?: number
  /** Entries left unacknowledged this long (a worker died) are taken over. */
  claimIdleMs?: number
  consumer?: string
}

type Entry = [id: string, fields: string[]]

function payloadOf(fields: string[]): string | undefined {
  for (let i = 0; i < fields.length; i += 2) {
    if (fields[i] === PAYLOAD_FIELD) return fields[i + 1]
  }
  return undefined
}

/** Splits entries into rows and the ids of entries that cannot be read (logged and dropped). */
export function decodeEntries(entries: Entry[]): { rows: unknown[]; ids: string[]; bad: string[] } {
  const rows: unknown[] = []
  const ids: string[] = []
  const bad: string[] = []
  for (const [id, fields] of entries) {
    ids.push(id)
    try {
      const parsed: unknown = JSON.parse(payloadOf(fields) ?? '')
      if (!Array.isArray(parsed)) throw new Error('not an array')
      rows.push(...parsed)
    } catch {
      bad.push(id)
    }
  }
  return { rows, ids, bad }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Reads a stream in the writers group and hands each batch to `handle`. An
 * entry is acknowledged and deleted only after `handle` resolves, so a crash
 * between the two means the entry is written again (at least once). When
 * `handle` throws (ClickHouse down), the same batch is retried with backoff.
 */
export function startConsumer(
  redis: Redis,
  kind: StreamKind,
  handle: BatchHandler,
  options: ConsumerOptions,
) {
  const key = STREAMS[kind]
  const count = options.count ?? 200
  const blockMs = options.blockMs ?? 2_000
  const claimIdleMs = options.claimIdleMs ?? 60_000
  const consumer = options.consumer ?? `${hostname()}-${process.pid}`
  const log = options.log.child({ stream: key })
  let stopped = false
  let lastClaim = 0

  async function ensureGroup() {
    try {
      await redis.xgroup('CREATE', key, WRITERS_GROUP, '0', 'MKSTREAM')
    } catch (err) {
      if (!String(err).includes('BUSYGROUP')) throw err
    }
  }

  async function read(): Promise<Entry[]> {
    if (Date.now() - lastClaim >= claimIdleMs) {
      lastClaim = Date.now()
      const claimed = (await redis.xautoclaim(
        key,
        WRITERS_GROUP,
        consumer,
        claimIdleMs,
        '0-0',
        'COUNT',
        count,
      )) as [string, Entry[], string[]]
      const entries = claimed[1].filter((entry) => entry?.[1])
      if (entries.length > 0) {
        log.warn({ entries: entries.length }, 'took over entries left by another worker')
        return entries
      }
    }
    const result = (await redis.xreadgroup(
      'GROUP',
      WRITERS_GROUP,
      consumer,
      'COUNT',
      count,
      'BLOCK',
      blockMs,
      'STREAMS',
      key,
      '>',
    )) as [string, Entry[]][] | null
    return result?.[0]?.[1] ?? []
  }

  async function finish(ids: string[]) {
    await redis
      .multi()
      .xack(key, WRITERS_GROUP, ...ids)
      .xdel(key, ...ids)
      .exec()
  }

  async function writeWithRetry(rows: unknown[], token: string): Promise<boolean> {
    for (let attempt = 0; !stopped; attempt++) {
      try {
        await handle(rows, token)
        return true
      } catch (err) {
        const wait = Math.min(1_000 * 2 ** attempt, 30_000)
        log.error({ err, rows: rows.length, retryInMs: wait }, 'write failed, retrying')
        await sleep(wait)
      }
    }
    return false
  }

  const done = (async () => {
    while (!stopped) {
      try {
        await ensureGroup()
        break
      } catch (err) {
        log.error({ err }, 'cannot reach Valkey, retrying')
        await sleep(2_000)
      }
    }
    while (!stopped) {
      try {
        const entries = await read()
        if (entries.length === 0) continue
        const { rows, ids, bad } = decodeEntries(entries)
        if (bad.length > 0) log.error({ ids: bad }, 'dropped unreadable entries')
        const token = `${key}:${ids[0]}:${ids[ids.length - 1]}`
        if (rows.length > 0 && !(await writeWithRetry(rows, token))) break
        await finish(ids)
      } catch (err) {
        log.error({ err }, 'stream read failed')
        await sleep(1_000)
      }
    }
  })()

  return {
    async stop() {
      stopped = true
      await done
    },
  }
}
