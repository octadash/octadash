import { createHash } from 'node:crypto'
import type { SaltStore } from '@octadash/queue'

/**
 * The visitor of an event without cookies: a hash of the day's salt, the
 * product, the address and the browser. The same person on the same day and
 * device counts once; tomorrow they get a new hash.
 */
export async function visitorHash(
  salts: SaltStore,
  at: Date,
  projectId: string,
  ip: string,
  userAgent: string,
): Promise<string> {
  if (!ip && !userAgent) return ''
  const salt = await salts.forDay(at.toISOString().slice(0, 10))
  return createHash('sha256')
    .update(`${salt}|${projectId}|${ip}|${userAgent}`)
    .digest('hex')
    .slice(0, 32)
}

/** The id the browser script keeps when the source counts returning visitors. */
export const BROWSER_ID = /^[0-9a-f]{32}$/

/**
 * The visitor of an event from a source that counts returning visitors: the
 * random id the browser keeps, hashed with the product so the same browser is
 * a different visitor in another product.
 */
export function persistentVisitor(projectId: string, browserId: string): string {
  return createHash('sha256').update(`${projectId}|${browserId}`).digest('hex').slice(0, 32)
}
