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
 * Events about the SDK itself or about person profiles, which Octadash does
 * not keep: autocapture clicks, recordings, flag calls, web vitals, person and
 * group updates. Exceptions belong to Errors, which takes Sentry SDKs.
 */
const SKIPPED = new Set([
  '$autocapture',
  '$rageclick',
  '$dead_click',
  '$copy_autocapture',
  '$snapshot',
  '$web_vitals',
  '$feature_flag_called',
  '$feature_view',
  '$feature_interaction',
  '$exception',
  '$set',
  '$groupidentify',
  '$create_alias',
  '$merge_dangerously',
  '$opt_in',
  '$heatmap',
  '$survey_shown',
  '$survey_dismissed',
])

/** Properties that repeat the person's id; the id itself is kept only as a hash. */
const ID_PROPERTIES = ['distinct_id', '$user_id', '$anon_distinct_id', '$device_id', 'token']

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

export interface PostHogBatch {
  key: string | undefined
  events: IncomingEvent[]
  /** Events left out by SKIPPED, counted so a test can see them go. */
  skipped: number
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
  let skipped = 0
  for (const item of raw) {
    if (!isObject(item)) continue
    const name = str(item.event)?.trim()
    if (!name) continue
    const properties: Json = isObject(item.properties) ? { ...item.properties } : {}
    key ??= str(item.api_key) ?? str(properties.token) ?? str(item.token)
    if (SKIPPED.has(name)) {
      skipped++
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
  return { key, events, skipped }
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
