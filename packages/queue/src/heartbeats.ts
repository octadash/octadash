import type { Redis } from 'ioredis'

const PREFIX = 'octadash:hb:'
const FAIL_PREFIX = 'octadash:hbf:'
/** What the job sent with its ping (its output), next to the ping's time. */
const OUTPUT_PREFIX = 'octadash:hbo:'
const FAIL_OUTPUT_PREFIX = 'octadash:hbfo:'
/** A ping older than this is gone; no monitor waits longer than a day plus its grace. */
const TTL_SECONDS = 3 * 24 * 3600

/**
 * The last ping of each heartbeat monitor. The ingest records pings without
 * touching Postgres; the worker reads them on its uptime tick.
 */
export interface HeartbeatStore {
  /** `output` is the body the job posted (its log), kept with this ping. */
  record(monitorId: string, at: number, output?: string): Promise<void>
  read(monitorIds: string[]): Promise<Map<string, number>>
  /** The job called /fail: it ran and reports it failed. */
  recordFailure(monitorId: string, at: number, output?: string): Promise<void>
  readFailures(monitorIds: string[]): Promise<Map<string, number>>
  /** The output sent with the last ping or failure, and the time it came with. */
  readOutputs(monitorIds: string[], failed: boolean): Promise<Map<string, HeartbeatOutput>>
}

export interface HeartbeatOutput {
  at: number
  output: string
}

export class ValkeyHeartbeats implements HeartbeatStore {
  constructor(private readonly redis: Redis) {}

  async record(monitorId: string, at: number, output?: string) {
    await this.save(PREFIX, OUTPUT_PREFIX, monitorId, at, output)
  }

  read(monitorIds: string[]) {
    return this.readAll(PREFIX, monitorIds)
  }

  async recordFailure(monitorId: string, at: number, output?: string) {
    await this.save(FAIL_PREFIX, FAIL_OUTPUT_PREFIX, monitorId, at, output)
  }

  async readOutputs(monitorIds: string[], failed: boolean) {
    const outputs = new Map<string, HeartbeatOutput>()
    if (monitorIds.length === 0) return outputs
    const prefix = failed ? FAIL_OUTPUT_PREFIX : OUTPUT_PREFIX
    const values = await this.redis.mget(monitorIds.map((id) => prefix + id))
    monitorIds.forEach((id, i) => {
      try {
        const value = JSON.parse(values[i] ?? '') as HeartbeatOutput
        if (typeof value.at === 'number' && typeof value.output === 'string') outputs.set(id, value)
      } catch {
        // No output with this monitor's last ping.
      }
    })
    return outputs
  }

  private async save(
    prefix: string,
    outputPrefix: string,
    id: string,
    at: number,
    output?: string,
  ) {
    const multi = this.redis.multi().set(prefix + id, String(at), 'EX', TTL_SECONDS)
    if (output) multi.set(outputPrefix + id, JSON.stringify({ at, output }), 'EX', TTL_SECONDS)
    await multi.exec()
  }

  readFailures(monitorIds: string[]) {
    return this.readAll(FAIL_PREFIX, monitorIds)
  }

  private async readAll(prefix: string, monitorIds: string[]) {
    const pings = new Map<string, number>()
    if (monitorIds.length === 0) return pings
    const values = await this.redis.mget(monitorIds.map((id) => prefix + id))
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
  readonly failures = new Map<string, number>()
  readonly outputs = new Map<string, HeartbeatOutput & { failed: boolean }>()

  async record(monitorId: string, at: number, output?: string) {
    this.pings.set(monitorId, at)
    if (output) this.outputs.set(monitorId, { at, output, failed: false })
  }

  async read(monitorIds: string[]) {
    return pick(this.pings, monitorIds)
  }

  async recordFailure(monitorId: string, at: number, output?: string) {
    this.failures.set(monitorId, at)
    if (output) this.outputs.set(monitorId, { at, output, failed: true })
  }

  async readOutputs(monitorIds: string[], failed: boolean) {
    const out = new Map<string, HeartbeatOutput>()
    for (const id of monitorIds) {
      const entry = this.outputs.get(id)
      if (entry && entry.failed === failed) out.set(id, { at: entry.at, output: entry.output })
    }
    return out
  }

  async readFailures(monitorIds: string[]) {
    return pick(this.failures, monitorIds)
  }
}

function pick(from: Map<string, number>, ids: string[]) {
  return new Map(
    ids.flatMap((id) => {
      const at = from.get(id)
      return at === undefined ? [] : [[id, at] as const]
    }),
  )
}
