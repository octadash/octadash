import { uuidv7 } from '@octadash/core'
import { type EventRow, NO_SOURCE, toClickHouseTime } from '@octadash/db'
import { z } from 'zod'
import { pageFields, parseUserAgent } from './context'
import type { IngestScope } from './keys'
import { personId, withoutPersonalData } from './privacy'
import { BROWSER_ID, persistentVisitor } from './visitor'

export const MAX_EVENTS_PER_REQUEST = 1_000
export const MAX_PROPERTIES_BYTES = 32 * 1024
/** Clocks drift; an event dated further ahead than this gets the time it arrived. */
const MAX_FUTURE_MS = 60 * 60 * 1000

const eventSchema = z.object({
  event: z.string().trim().min(1).max(200),
  /** ISO 8601 or milliseconds since 1970. Missing means "now". */
  timestamp: z.union([z.iso.datetime({ offset: true }), z.number().int().nonnegative()]).optional(),
  distinct_id: z.string().max(200).optional(),
  session_id: z.string().max(200).optional(),
  uuid: z.uuid().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
})

/**
 * Octadash's own event format (`POST /o/v1/events`). The browser script and the
 * Node SDK send this. The key may come in the body because navigator.sendBeacon
 * cannot set headers.
 */
export const batchSchema = z.object({
  key: z.string().optional(),
  events: z.array(eventSchema).min(1).max(MAX_EVENTS_PER_REQUEST),
})

export type IncomingEvent = z.infer<typeof eventSchema>

function eventTime(value: IncomingEvent['timestamp'], received: Date): Date {
  if (value === undefined) return received
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || date.getTime() - received.getTime() > MAX_FUTURE_MS) {
    return received
  }
  return date
}

export class PropertiesTooLargeError extends Error {
  override name = 'PropertiesTooLargeError'
}

/** What the request says about who sent it; see context.ts. */
export interface Sender {
  /** Set when the request came from a browser (it carried an Origin or Referer). */
  ip: string
  userAgent: string
  country: string
  /** Hash for an address and browser on the received day. */
  visitor(ip: string, userAgent: string): Promise<string>
}

function text(value: unknown, max = 1000): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

/**
 * Turns validated events into the rows the worker writes to ClickHouse. A
 * server SDK sends on behalf of a visitor, so `$ip` and `$user_agent` in the
 * properties (PostHog's names) win over the request's own. `$visitor_id`, the
 * id the browser keeps, counts only when the source counts returning visitors,
 * and is never stored as it came. Nor is the person: `distinct_id` is kept as
 * a hash, and properties that look personal are dropped (see privacy.ts).
 */
export async function toEventRows(
  scope: IngestScope,
  events: IncomingEvent[],
  sender: Sender,
  received: Date = new Date(),
): Promise<EventRow[]> {
  const receivedAt = toClickHouseTime(received)
  const rows: EventRow[] = []
  for (const event of events) {
    const { $visitor_id: browserId, ...sent } = event.properties ?? {}
    const properties = JSON.stringify(withoutPersonalData(sent).properties)
    if (Buffer.byteLength(properties) > MAX_PROPERTIES_BYTES) {
      throw new PropertiesTooLargeError(event.event)
    }
    const ip = text(event.properties?.$ip, 100) || sender.ip
    const userAgent = text(event.properties?.$user_agent) || sender.userAgent
    const client = parseUserAgent(userAgent)
    rows.push({
      org_id: scope.org_id,
      project_id: scope.project_id,
      source_id: scope.source_id ?? NO_SOURCE,
      uuid: event.uuid ?? uuidv7(),
      timestamp: toClickHouseTime(eventTime(event.timestamp, received)),
      received_at: receivedAt,
      event: event.event,
      distinct_id: personId(scope.project_id, event.distinct_id ?? ''),
      session_id: event.session_id ?? '',
      properties,
      visitor_id:
        scope.visitor_mode === 'persistent' &&
        typeof browserId === 'string' &&
        BROWSER_ID.test(browserId)
          ? persistentVisitor(scope.project_id, browserId)
          : await sender.visitor(ip, userAgent),
      ...pageFields(event.properties),
      browser: client.browser,
      os: client.os,
      device: client.device,
      country: sender.country,
      is_bot: client.isBot ? 1 : 0,
    })
  }
  return rows
}
