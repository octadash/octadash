import { gunzipSync } from 'node:zlib'
import type { IncomingEvent } from './events'

/**
 * PostHog compatibility: what a PostHog SDK sends, read as Octadash events, so
 * a product already on PostHog changes only the host. The browser library
 * (posthog-js) posts to /e/ or /i/v0/e/, server SDKs post to /batch/ or
 * /capture/. Bodies come as JSON, gzip (`?compression=gzip-js` or
 * Content-Encoding) or a form with base64 JSON in `data`; lz-string (very old
 * posthog-js) is refused, and newer versions never send it once the flags
 * answer lists the formats we take. Checked with posthog-js 1.x and
 * posthog-node 5.x on 2026-11-28.
 */

/** Read from the request and its decompressed body. */
export interface PostHogRequest {
  body: Uint8Array
  contentType: string | undefined
  contentEncoding: string | undefined
  compression: string | undefined
}

export class UnsupportedCompression extends Error {
  override name = 'UnsupportedCompression'
}

const MAX_INFLATED_BYTES = 20 * 1024 * 1024

/** The JSON the SDK meant, whatever way it was packed. */
export function parsePostHogBody(request: PostHogRequest): unknown {
  let bytes = request.body
  const compression = request.compression?.toLowerCase()
  if (compression === 'lz64') throw new UnsupportedCompression('lz64')
  // Recent posthog-js gzips without saying so in the address or a header, so
  // the gzip magic bytes count too.
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b
  if (
    gzipped ||
    compression === 'gzip-js' ||
    compression === 'gzip' ||
    request.contentEncoding?.trim().toLowerCase() === 'gzip'
  ) {
    bytes = gunzipSync(bytes, { maxOutputLength: MAX_INFLATED_BYTES })
  }
  let text = new TextDecoder().decode(bytes)
  if (request.contentType?.includes('application/x-www-form-urlencoded')) {
    const form = new URLSearchParams(text)
    if (form.get('compression') === 'lz64') throw new UnsupportedCompression('lz64')
    const data = form.get('data') ?? ''
    text =
      data.trimStart().startsWith('{') || data.trimStart().startsWith('[')
        ? data
        : Buffer.from(data, 'base64').toString('utf8')
  }
  return JSON.parse(text)
}

/**
 * Events that are not product events: autocapture clicks, recordings, flag
 * calls, web vitals, surveys shown, person and group updates. They are not
 * thrown away: each goes to `received` as it came (masked), for the areas that
 * will read them. Exceptions go to Errors.
 */
export const NOT_PRODUCT_EVENTS = new Set([
  '$autocapture',
  '$rageclick',
  '$dead_click',
  '$copy_autocapture',
  '$snapshot',
  '$web_vitals',
  '$feature_flag_called',
  '$feature_view',
  '$feature_interaction',
  '$set',
  '$groupidentify',
  '$create_alias',
  '$merge_dangerously',
  '$opt_in',
  '$heatmap',
  '$survey_shown',
  '$survey_dismissed',
])

/** posthog-js and the server SDKs report errors as this event. */
export const EXCEPTION_EVENT = '$exception'

/** Properties that repeat the person's id; the id itself is kept only as a hash. */
const ID_PROPERTIES = ['distinct_id', '$user_id', '$anon_distinct_id', '$device_id', 'token']

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

/** An event that is not a product event, as it came. */
export interface PostHogItem {
  name: string
  item: Json
  /** When it happened, read like a product event's time. */
  at: Date | undefined
  /** Size as it arrived, in JSON. */
  bytes: number
}

export interface PostHogBatch {
  key: string | undefined
  events: IncomingEvent[]
  /** `$exception` events, for Errors. */
  exceptions: PostHogItem[]
  /** NOT_PRODUCT_EVENTS, for `received`. */
  other: PostHogItem[]
}

/**
 * The events and the key of any PostHog body: one event, a list of events, or
 * `{ api_key, batch: [...] }`. The key is `api_key`, `token` or the event's
 * `properties.token`. `offset` (milliseconds before sending) dates an event
 * that has no timestamp.
 */
export function readPostHogBatch(body: unknown, received: Date): PostHogBatch {
  let raw: unknown[] = []
  let key: string | undefined
  let sentAt = received.getTime()
  if (Array.isArray(body)) raw = body
  else if (isObject(body)) {
    key = str(body.api_key) ?? str(body.token)
    const sent = Date.parse(str(body.sent_at) ?? '')
    if (!Number.isNaN(sent)) sentAt = Math.min(sent, received.getTime())
    raw = Array.isArray(body.batch) ? body.batch : Array.isArray(body.data) ? body.data : [body]
  }

  const events: IncomingEvent[] = []
  const exceptions: PostHogItem[] = []
  const other: PostHogItem[] = []
  for (const item of raw) {
    if (!isObject(item)) continue
    const name = str(item.event)?.trim()
    if (!name) continue
    const properties: Json = isObject(item.properties) ? { ...item.properties } : {}
    key ??= str(item.api_key) ?? str(properties.token) ?? str(item.token)
    if (name === EXCEPTION_EVENT || NOT_PRODUCT_EVENTS.has(name)) {
      const at = Date.parse(str(item.timestamp) ?? '')
      const entry: PostHogItem = {
        name,
        item,
        at: !Number.isNaN(at)
          ? new Date(at)
          : typeof item.offset === 'number'
            ? new Date(sentAt - item.offset)
            : undefined,
        bytes: Buffer.byteLength(JSON.stringify(item)),
      }
      ;(name === EXCEPTION_EVENT ? exceptions : other).push(entry)
      continue
    }
    const distinctId =
      str(item.distinct_id) ?? str(properties.distinct_id) ?? str(item.$distinct_id) ?? undefined
    const sessionId = str(properties.$session_id)
    for (const property of ID_PROPERTIES) delete properties[property]

    let timestamp: number | undefined
    const at = Date.parse(str(item.timestamp) ?? '')
    if (!Number.isNaN(at)) timestamp = at
    else if (typeof item.offset === 'number') timestamp = sentAt - item.offset
    const uuid = str(item.uuid)

    events.push({
      event: name.slice(0, 200),
      timestamp: timestamp !== undefined && timestamp >= 0 ? Math.round(timestamp) : undefined,
      distinct_id: distinctId?.slice(0, 200),
      session_id: sessionId?.slice(0, 200),
      uuid:
        uuid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)
          ? uuid.toLowerCase()
          : undefined,
      properties,
    })
  }
  return { key, events, exceptions, other }
}

/**
 * A `$exception` event in the shape of a Sentry event, so Errors reads it with
 * the same code: `$exception_list` is already Sentry's exception list, cause
 * first where Sentry puts it last. Older SDKs sent only the type and message.
 */
export function exceptionAsSentryEvent(entry: PostHogItem): Json {
  const properties = isObject(entry.item.properties) ? entry.item.properties : {}
  let list = Array.isArray(properties.$exception_list) ? [...properties.$exception_list] : []
  if (list.length === 0) {
    const type = str(properties.$exception_type)
    const value = str(properties.$exception_message)
    if (type || value) list = [{ type, value }]
  }
  const fingerprint = properties.$exception_fingerprint
  const distinctId = str(entry.item.distinct_id) ?? str(properties.distinct_id)
  const url = str(properties.$current_url)
  const userAgent = str(properties.$raw_user_agent) ?? str(properties.$user_agent)
  const uuid = str(entry.item.uuid)?.replaceAll('-', '').toLowerCase()
  const lib = str(properties.$lib)
  return {
    event_id: uuid && /^[0-9a-f]{32}$/.test(uuid) ? uuid : undefined,
    timestamp: (entry.at ?? new Date()).toISOString(),
    level: str(properties.$exception_level) ?? 'error',
    platform: lib === 'web' ? 'javascript' : (lib ?? 'other'),
    exception: { values: list.reverse() },
    fingerprint:
      typeof fingerprint === 'string'
        ? [fingerprint]
        : Array.isArray(fingerprint)
          ? fingerprint
          : undefined,
    release: str(properties.$app_version) ?? str(properties.release),
    environment: str(properties.environment) ?? str(properties.$environment),
    request:
      url || userAgent ? { url, headers: userAgent ? { 'User-Agent': userAgent } : {} } : undefined,
    user: distinctId ? { id: distinctId } : undefined,
    sdk: lib ? { name: `posthog-${lib}` } : undefined,
  }
}

/**
 * What /flags/ and /decide/ answer: no flags, and every extra of posthog-js
 * turned off (autocapture, recordings, surveys, heatmaps), so the browser
 * sends only page views and the events the app captures.
 */
export const POSTHOG_FLAGS = {
  config: { enable_collect_everything: false },
  featureFlags: {},
  featureFlagPayloads: {},
  flags: {},
  errorsWhileComputingFlags: false,
  quotaLimited: [],
  requestId: '',
  sessionRecording: false,
  autocapture_opt_out: true,
  autocaptureExceptions: false,
  capturePerformance: false,
  heatmaps: false,
  surveys: false,
  siteApps: [],
  toolbarParams: {},
  isAuthenticated: false,
  supportedCompression: ['gzip', 'gzip-js'],
  elementsChainAsString: true,
  defaultIdentifiedOnly: true,
}

/** Where `/static/array.js` and the other posthog-js files are served from. */
export const POSTHOG_ASSETS = 'https://us-assets.i.posthog.com/static/'
