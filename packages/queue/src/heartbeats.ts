import type { Redis } from 'ioredis'

const PREFIX = 'octadash:hb:'
/** A ping older than this is gone; no monitor waits longer than a day plus its grace. */
const TTL_SECONDS = 3 * 24 * 3600

/**
 * The last ping of each heartbeat monitor. The ingest records pings without
 * touching Postgres; the worker reads them on its uptime tick.
 */
export interface HeartbeatStore {
  record(monitorId: string, at: number): Promise<void>
  read(monitorIds: string[]): Promise<Map<string, number>>
}

export class ValkeyHeartbeats implements HeartbeatStore {
  constructor(private readonly redis: Redis) {}

  async record(monitorId: string, at: number) {
    await this.redis.set(PREFIX + monitorId, String(at), 'EX', TTL_SECONDS)
  }

  async read(monitorIds: string[]) {
    const pings = new Map<string, number>()
    if (monitorIds.length === 0) return pings
    const values = await this.redis.mget(monitorIds.map((id) => PREFIX + id))
    monitorIds.forEach((id, i) => {
      const value = Number(values[i])
      if (values[i] && Number.isFinite(value)) pings.set(id, value)
    })
    return pings
  }
}

/** In memory. For tests. */
export class MemoryHeartbeats implements HeartbeatStore {
  readonly pings = new Map<string, number>()

  async record(monitorId: string, at: number) {
    this.pings.set(monitorId, at)
  }

  async read(monitorIds: string[]) {
    return new Map(
      monitorIds.flatMap((id) => {
        const at = this.pings.get(id)
        return at === undefined ? [] : [[id, at] as const]
      }),
    )
  }
}
