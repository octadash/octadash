import { uuidv7 } from '@octadash/core'
import { type EventRow, toClickHouseTime } from '@octadash/db'
import { z } from 'zod'
import type { IngestScope } from './keys'

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

/** Turns validated events into the rows the worker writes to ClickHouse. */
export function toEventRows(
  scope: IngestScope,
  events: IncomingEvent[],
  received: Date = new Date(),
): EventRow[] {
  const receivedAt = toClickHouseTime(received)
  return events.map((event) => {
    const properties = JSON.stringify(event.properties ?? {})
    if (Buffer.byteLength(properties) > MAX_PROPERTIES_BYTES) {
      throw new PropertiesTooLargeError(event.event)
    }
    return {
      org_id: scope.org_id,
      project_id: scope.project_id,
      uuid: event.uuid ?? uuidv7(),
      timestamp: toClickHouseTime(eventTime(event.timestamp, received)),
      received_at: receivedAt,
      event: event.event,
      distinct_id: event.distinct_id ?? '',
      session_id: event.session_id ?? '',
      properties,
    }
  })
}
