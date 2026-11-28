import { DROPPED_PREFIX, NO_SOURCE, type QueuedReceived, toClickHouseTime } from '@octadash/db'
import type { DiscardReason } from './fates'
import type { IngestScope } from './keys'
import { PERSONAL_NAME, personId } from './privacy'
import { redact, SECRET_NAME } from './redact'

/**
 * Data that arrives and no area reads yet is kept, not thrown away: it goes to
 * the `received` table as it came, masked, and an area that comes later reads
 * its history from there. Leaving something out is the exception, and every
 * exception is listed in DISCARDS (see fates.ts) and counted with a
 * `dropped:` row, so nothing goes missing silently.
 */

/** An item bigger than this, as it arrived, is counted instead of kept. */
export const MAX_RECEIVED_BYTES = 1024 * 1024
/** Nesting deeper than this is kept as JSON text, unmasked keys and all masked strings. */
const MAX_DEPTH = 32

/** Ids of a person: kept only as the product's hash, like `distinct_id` in events. */
const PERSON_ID_KEYS = new Set([
  'distinct_id',
  '$distinct_id',
  'distinctid',
  '$user_id',
  'user_id',
  '$anon_distinct_id',
  '$device_id',
  'did',
])
/** Keys that hold the ingest key itself; it says nothing and is removed. */
const KEY_KEYS = new Set(['token', '$token', 'api_key'])
/** A person's name: masked under objects that describe a person. */
const NAME_KEYS = /^(name|first_?name|last_?name|full_?name|nome|sobrenome|username)$/i
const PERSON_CONTAINERS = new Set(['$set', '$set_once', 'user', 'feedback', 'person'])
const EMAIL_KEY = /(^|_)(e-?mail|contact_email)$/i

const words = (name: string) => name.replace(/^\$+/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2')

export interface Masked {
  value: unknown
  masked: number
}

/**
 * A copy of any JSON value with what identifies a person or opens a door
 * masked: secrets and personal fields by name (password, email, cpf, phone,
 * ip...), a person's name inside a person object, ids of a person replaced by
 * their hash, and e-mails, documents, cards and keys inside any text.
 */
export function maskDeep(projectId: string, input: unknown): Masked {
  let masked = 0
  const walk = (value: unknown, depth: number, person: boolean): unknown => {
    if (typeof value === 'string') {
      const cleaned = redact(value)
      masked += cleaned.masked
      return cleaned.text
    }
    if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, false))
    if (!value || typeof value !== 'object') return value
    if (depth >= MAX_DEPTH) return walk(JSON.stringify(value), depth, false)
    const entries = Object.entries(value as Record<string, unknown>)
    const describesPerson = person || entries.some(([key]) => EMAIL_KEY.test(words(key)))
    const out: Record<string, unknown> = {}
    for (const [key, item] of entries) {
      const lower = key.toLowerCase()
      if (KEY_KEYS.has(lower)) continue
      const empty = item === null || item === undefined || item === ''
      if (PERSON_ID_KEYS.has(lower) && (typeof item === 'string' || typeof item === 'number')) {
        out[key] = personId(projectId, String(item))
        continue
      }
      const name = words(key)
      if (
        !empty &&
        (SECRET_NAME.test(name) ||
          PERSONAL_NAME.test(name) ||
          (describesPerson && NAME_KEYS.test(name)))
      ) {
        out[key] = '[masked]'
        masked++
        continue
      }
      out[key] = walk(item, depth + 1, PERSON_CONTAINERS.has(lower))
    }
    return out
  }
  const value = walk(input, 0, false)
  return { value, masked: Math.min(65_535, masked) }
}

/** A body as it came: JSON when it parses, text when it is text, else bytes. */
export type ReceivedBody =
  | { encoding: 'json'; value: unknown }
  | { encoding: 'text'; value: string }
  | { encoding: 'base64'; value: Uint8Array }

const strict = new TextDecoder('utf-8', { fatal: true })

/** Reads bytes as JSON, else text, else binary. */
export function bodyOf(bytes: Uint8Array): ReceivedBody {
  let text: string
  try {
    text = strict.decode(bytes)
  } catch {
    return { encoding: 'base64', value: bytes }
  }
  try {
    return { encoding: 'json', value: JSON.parse(text) }
  } catch {
    return { encoding: 'text', value: text }
  }
}

/** Seconds since 1970 (Sentry), milliseconds (PostHog) or an ISO date. */
export function timeOf(value: unknown): Date | undefined {
  let date: Date | undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value < 1e11 ? value * 1000 : value)
  } else if (typeof value === 'string' && value) {
    date = new Date(value)
  }
  return date && !Number.isNaN(date.getTime()) ? date : undefined
}

const MAX_FUTURE_MS = 60 * 60 * 1000

export interface ReceivedInput {
  kind: string
  /** Extra facts about the item kept next to its body (a Sentry item header). */
  meta?: Record<string, unknown>
  body: ReceivedBody
  /** Size as it arrived. */
  bytes: number
  /** When it happened, as the sender said. */
  at?: Date
}

/**
 * One received item as a row for the `received` stream: `{ meta, body }` as
 * JSON, the body masked (text through `redact`, JSON through `maskDeep`; bytes
 * cannot be read and are kept as sent, in base64). Too big: a `dropped:` row.
 */
export function receivedRow(
  scope: IngestScope,
  input: ReceivedInput,
  received: Date,
): QueuedReceived {
  if (input.bytes > MAX_RECEIVED_BYTES) {
    return droppedRow(scope, input.kind, 'too_large', input.bytes, 1, received)
  }
  let masked = 0
  let body: unknown
  if (input.body.encoding === 'json') {
    const out = maskDeep(scope.project_id, input.body.value)
    body = out.value
    masked += out.masked
  } else if (input.body.encoding === 'text') {
    const out = redact(input.body.value)
    body = out.text
    masked += out.masked
  } else {
    body = Buffer.from(input.body.value).toString('base64')
  }
  let meta: unknown
  if (input.meta) {
    const out = maskDeep(scope.project_id, input.meta)
    meta = out.value
    masked += out.masked
  }
  const at =
    input.at && input.at.getTime() - received.getTime() <= MAX_FUTURE_MS ? input.at : received
  return {
    org_id: scope.org_id,
    project_id: scope.project_id,
    source_id: scope.source_id ?? NO_SOURCE,
    kind: input.kind.slice(0, 200),
    timestamp: toClickHouseTime(at),
    received_at: toClickHouseTime(received),
    payload: JSON.stringify(meta === undefined ? { body } : { meta, body }),
    encoding: input.body.encoding,
    bytes: input.bytes,
    masked: Math.min(65_535, masked),
  }
}

/**
 * A row that holds no data, only that `count` items of `kind` (`bytes` in all)
 * were left out and why. The reason is one of DISCARDS in fates.ts.
 */
export function droppedRow(
  scope: IngestScope,
  kind: string,
  reason: DiscardReason,
  bytes: number,
  count: number,
  received: Date,
): QueuedReceived {
  return {
    org_id: scope.org_id,
    project_id: scope.project_id,
    source_id: scope.source_id ?? NO_SOURCE,
    kind: `${DROPPED_PREFIX}${kind}`.slice(0, 200),
    timestamp: toClickHouseTime(received),
    received_at: toClickHouseTime(received),
    payload: JSON.stringify({ reason, count }),
    encoding: 'json',
    bytes,
    masked: 0,
  }
}
