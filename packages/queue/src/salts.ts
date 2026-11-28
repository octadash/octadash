import { randomBytes } from 'node:crypto'
import type { Redis } from 'ioredis'

const PREFIX = 'octadash:salt:'
/** A salt lives two days, so yesterday's late events still hash; then it is gone for good. */
const TTL_SECONDS = 2 * 24 * 3600

/**
 * One random salt per UTC day, shared by every ingest process. Visitors are
 * counted by a hash of the salt with their address and browser; once the salt
 * expires nobody, Octadash included, can link two days or recover an address.
 */
export interface SaltStore {
  forDay(day: string): Promise<string>
}

export class ValkeySalts implements SaltStore {
  private readonly cache = new Map<string, string>()

  constructor(private readonly redis: Redis) {}

  async forDay(day: string) {
    const cached = this.cache.get(day)
    if (cached) return cached
    const key = PREFIX + day
    await this.redis.set(key, randomBytes(32).toString('hex'), 'EX', TTL_SECONDS, 'NX')
    const salt = await this.redis.get(key)
    if (!salt) throw new Error('salt not stored')
    if (this.cache.size > 3) this.cache.clear()
    this.cache.set(day, salt)
    return salt
  }
}

/** In memory. For tests. */
export class MemorySalts implements SaltStore {
  private readonly salts = new Map<string, string>()

  async forDay(day: string) {
    let salt = this.salts.get(day)
    if (!salt) {
      salt = randomBytes(32).toString('hex')
      this.salts.set(day, salt)
    }
    return salt
  }
}
