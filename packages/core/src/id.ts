import { randomBytes } from 'node:crypto'

/**
 * Generates a UUID version 7 (RFC 9562): 48 bits of Unix time in milliseconds
 * followed by random bits. Ids sort by creation time, which keeps btree indexes
 * compact on high-volume tables. Works on any Postgres version (no uuidv7() needed).
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16)
  const ts = BigInt(now)
  bytes[0] = Number((ts >> 40n) & 0xffn)
  bytes[1] = Number((ts >> 32n) & 0xffn)
  bytes[2] = Number((ts >> 24n) & 0xffn)
  bytes[3] = Number((ts >> 16n) & 0xffn)
  bytes[4] = Number((ts >> 8n) & 0xffn)
  bytes[5] = Number(ts & 0xffn)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Extracts the creation time from a UUID version 7. */
export function uuidv7Time(id: string): Date {
  const hex = id.replaceAll('-', '').slice(0, 12)
  return new Date(Number.parseInt(hex, 16))
}
