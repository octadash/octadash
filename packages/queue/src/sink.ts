import type { Redis } from 'ioredis'
import { PAYLOAD_FIELD, STREAMS, type StreamKind } from './streams'

/**
 * Where the ingest puts what it accepted. The request path never touches a
 * database: it appends to a stream and answers. Tests use MemorySink; the cloud
 * can swap the transport without changing the routes.
 */
export interface EventSink {
  /** Appends one batch of rows as a single stream entry. */
  write(kind: StreamKind, rows: readonly unknown[]): Promise<void>
  /** True when the worker is so far behind that the ingest should answer 429. */
  isFull(kind: StreamKind): boolean
}

export interface ValkeySinkOptions {
  /** Entries waiting in a stream before the ingest starts answering 429. */
  maxPending?: number
  /** How often the stream lengths are read. One XLEN per stream per tick. */
  pollMs?: number
}

export class ValkeySink implements EventSink {
  private readonly lengths = new Map<StreamKind, number>()
  private readonly maxPending: number
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly redis: Redis,
    options: ValkeySinkOptions = {},
  ) {
    this.maxPending = options.maxPending ?? 100_000
    const pollMs = options.pollMs ?? 1_000
    this.timer = setInterval(() => void this.poll(), pollMs)
    this.timer.unref()
    void this.poll()
  }

  private async poll() {
    for (const [kind, key] of Object.entries(STREAMS) as [StreamKind, string][]) {
      try {
        this.lengths.set(kind, await this.redis.xlen(key))
      } catch {
        // Disconnected: write() fails on its own, so the last length is kept.
      }
    }
  }

  async write(kind: StreamKind, rows: readonly unknown[]): Promise<void> {
    await this.redis.xadd(STREAMS[kind], '*', PAYLOAD_FIELD, JSON.stringify(rows))
  }

  isFull(kind: StreamKind): boolean {
    return (this.lengths.get(kind) ?? 0) >= this.maxPending
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

/** Keeps batches in memory. For tests. */
export class MemorySink implements EventSink {
  readonly batches: { kind: StreamKind; rows: unknown[] }[] = []
  full = false
  failing = false

  async write(kind: StreamKind, rows: readonly unknown[]): Promise<void> {
    if (this.failing) throw new Error('sink unavailable')
    this.batches.push({ kind, rows: [...rows] })
  }

  isFull(): boolean {
    return this.full
  }
}
