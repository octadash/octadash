import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import { OCTADASH_VERSION } from '@octadash/core'
import type { EventRow, QueuedError, QueuedReceived } from '@octadash/db'
import type { EventSink, HeartbeatStore, SaltStore } from '@octadash/queue'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { requestContext } from './context'
import { type EnvelopeItem, parseEnvelope, sentryKey, toErrorRow } from './errors'
import {
  batchSchema,
  type IncomingEvent,
  MAX_EVENTS_PER_REQUEST,
  PropertiesTooLargeError,
  type Sender,
  toEventRows,
} from './events'
import type { HeartbeatResolver, IngestScope, KeyResolver } from './keys'
import { MAX_LOGS_PER_REQUEST, toLogRows } from './logs'
import { MAX_POINTS_PER_REQUEST, toMetricRows } from './metrics'
import { decodeLogsJson, decodeLogsProtobuf, exportAnswer, type OtlpLog } from './otlp'
import { decodeMetricsJson, decodeMetricsProtobuf, type OtlpPoint } from './otlp-metrics'
import { decodeTracesJson, decodeTracesProtobuf, type OtlpSpan } from './otlp-traces'
import {
  exceptionAsSentryEvent,
  POSTHOG_ASSETS,
  POSTHOG_FLAGS,
  parsePostHogBody,
  readPostHogBatch,
  UnsupportedCompression,
} from './posthog'
import { bodyOf, droppedRow, receivedRow, timeOf } from './received'
import { BROWSER_SCRIPT } from './script'
import { sentryLogs, standaloneSpan, transactionSpans } from './sentry-traces'
import { MAX_SPANS_PER_REQUEST, toSpanRows } from './spans'
import { visitorHash } from './visitor'

/** Requests bigger than this are refused before they are read. */
export const MAX_BODY_BYTES = 1024 * 1024
/** Sentry envelopes may carry attachments; each is kept in `received` up to its own limit. */
export const MAX_ENVELOPE_BYTES = 10 * 1024 * 1024
/** At most this much after decompression. */
const MAX_INFLATED_BYTES = 20 * 1024 * 1024
/** Error events taken from one request. */
const MAX_ERRORS_PER_REQUEST = 100
/** Seconds an SDK should wait when the queue is full. */
const RETRY_AFTER_SECONDS = 30

export interface IngestDeps {
  sink: EventSink
  keys: KeyResolver
  heartbeats: { resolver: HeartbeatResolver; store: HeartbeatStore }
  /** Daily salts for the visitor hash. */
  salts: SaltStore
  now?: () => number
  onError?: (err: unknown) => void
}

/**
 * The ingest service only receives data. It validates the key, puts the batch
 * on a Valkey stream and answers at once; the worker writes to ClickHouse
 * behind it. It speaks several wire formats so existing SDKs work by changing
 * one URL:
 *   - Octadash script/SDK   /o/v1/events                       (step 1)
 *   - Sentry envelopes      /api/:projectId/envelope/          (errors step)
 *   - PostHog capture       /e/, /i/v0/e/, /batch/, /capture/, /flags/
 *   - OpenTelemetry (OTLP)  /v1/logs, /v1/traces, /v1/metrics (also under /otlp/)
 * Heartbeat monitors ping /hb/<token> (GET or POST) from cron jobs and backups.
 * The health check touches nothing, so uptime probes never wake a database.
 */
export function createApp(deps: IngestDeps) {
  const app = new Hono()
  const now = deps.now ?? Date.now

  // SDKs call ingest from browsers on other domains.
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: [
        'content-type',
        'content-encoding',
        'authorization',
        'x-octadash-key',
        'x-sentry-auth',
      ],
      maxAge: 86_400,
    }),
  )

  app.get('/health', (c) => c.json({ status: 'ok', service: 'ingest', version: OCTADASH_VERSION }))

  // The browser script. An hour of cache: a fix reaches every site within the hour.
  app.get('/o/v1/script.js', (c) =>
    c.body(BROWSER_SCRIPT, 200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    }),
  )

  // A cron job or backup reports that it ran. The token is the secret; the
  // ping is kept in Valkey and the worker compares it with the monitor's interval.
  // `/fail` reports that the job ran and failed, so people hear at once
  // instead of after the grace.
  const heartbeat = (failed: boolean) => async (c: Context) => {
    const token = c.req.param('token') ?? ''
    let monitorId: string | null
    try {
      monitorId = await deps.heartbeats.resolver.resolve(token)
      if (monitorId) {
        if (failed) await deps.heartbeats.store.recordFailure(monitorId, now())
        else await deps.heartbeats.store.record(monitorId, now())
      }
    } catch (err) {
      deps.onError?.(err)
      return c.json({ error: 'unavailable' }, 503)
    }
    if (!monitorId) return c.json({ error: 'unknown_heartbeat' }, 404)
    return c.json({ ok: true })
  }
  for (const prefix of ['/hb', '/o/v1/hb']) {
    app.get(`${prefix}/:token`, heartbeat(false))
    app.post(`${prefix}/:token`, heartbeat(false))
    app.get(`${prefix}/:token/fail`, heartbeat(true))
    app.post(`${prefix}/:token/fail`, heartbeat(true))
  }

  /** Who sent the request, as `toEventRows` and `toErrorRow` read it. */
  const senderOf = (c: Context, projectId: string, received: Date): Sender => {
    const request = requestContext((name) => c.req.header(name))
    // Only a browser speaks for a visitor; a server's own address is nobody.
    const fromBrowser = Boolean(c.req.header('origin') || c.req.header('referer'))
    return {
      ip: fromBrowser ? request.ip : '',
      userAgent: fromBrowser ? request.userAgent : '',
      country: request.country,
      visitor: (ip, ua) => visitorHash(deps.salts, received, projectId, ip, ua),
    }
  }

  /** The product and source a key sends for, or the answer to give when there is none. */
  const scopeOf = async (c: Context, key: string): Promise<IngestScope | Response> => {
    let scope: IngestScope | null
    try {
      scope = await deps.keys.resolve(key)
    } catch (err) {
      deps.onError?.(err)
      return c.json({ error: 'unavailable' }, 503)
    }
    return scope ?? c.json({ error: 'invalid_key' }, 401)
  }

  /** Queues rows on a stream; a Response when the queue cannot take them. */
  const queue = async (
    c: Context,
    kind: 'events' | 'errors' | 'received' | 'spans' | 'logs',
    rows: readonly unknown[],
  ): Promise<Response | null> => {
    if (rows.length === 0) return null
    try {
      await deps.sink.write(kind, rows)
      return null
    } catch (err) {
      deps.onError?.(err)
      return c.json({ error: 'unavailable' }, 503, { 'retry-after': '5' })
    }
  }

  /**
   * Queues the events: the same path for the Octadash format and PostHog's.
   * Answers with a Response on failure, or the count.
   */
  const acceptEvents = async (
    c: Context,
    scope: IngestScope,
    events: IncomingEvent[],
  ): Promise<Response | number> => {
    if (events.length === 0) return 0
    const received = new Date(now())
    let rows: EventRow[]
    try {
      rows = await toEventRows(scope, events, senderOf(c, scope.project_id, received), received)
    } catch (err) {
      if (err instanceof PropertiesTooLargeError) {
        return c.json({ error: 'properties_too_large', event: err.message }, 400)
      }
      deps.onError?.(err)
      return c.json({ error: 'unavailable' }, 503, { 'retry-after': '5' })
    }
    return (await queue(c, 'events', rows)) ?? rows.length
  }

  app.post(
    '/o/v1/events',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'body_too_large' }, 413),
    }),
    async (c) => {
      if (deps.sink.isFull('events')) return queueFull(c)

      // sendBeacon posts text/plain to skip the CORS preflight, so the body is
      // parsed as JSON whatever the content type says.
      let body: unknown
      try {
        body = JSON.parse(await c.req.text())
      } catch {
        return c.json({ error: 'invalid_json' }, 400)
      }
      const parsed = batchSchema.safeParse(body)
      if (!parsed.success) {
        return c.json(
          {
            error: 'invalid_body',
            issues: parsed.error.issues
              .slice(0, 10)
              .map((i) => ({ path: i.path.join('.'), message: i.message })),
          },
          400,
        )
      }
      const scope = await scopeOf(c, keyFrom(c) ?? parsed.data.key ?? '')
      if (scope instanceof Response) return scope
      const accepted = await acceptEvents(c, scope, parsed.data.events)
      return typeof accepted === 'number' ? c.json({ accepted }, 202) : accepted
    },
  )

  /**
   * PostHog SDKs, by changing only the host (see posthog.ts). They read
   * `{ status: 1 }` as accepted. Product events go to `events`, `$exception`
   * to Errors, and the rest (autocapture, web vitals, profile updates...) to
   * `received`.
   */
  const posthog = async (c: Context) => {
    if (deps.sink.isFull('events') || deps.sink.isFull('received')) return queueFull(c)
    let body: unknown
    try {
      body = parsePostHogBody({
        body: new Uint8Array(await c.req.arrayBuffer()),
        contentType: c.req.header('content-type'),
        contentEncoding: c.req.header('content-encoding'),
        compression: c.req.query('compression'),
      })
    } catch (err) {
      if (err instanceof UnsupportedCompression) {
        return c.json({ error: 'unsupported_compression' }, 400)
      }
      return c.json({ error: 'invalid_body' }, 400)
    }
    const batch = readPostHogBatch(body, new Date(now()))
    if (batch.events.length > MAX_EVENTS_PER_REQUEST) {
      return c.json({ error: 'too_many_events' }, 400)
    }
    const scope = await scopeOf(c, keyFrom(c) ?? batch.key ?? '')
    if (scope instanceof Response) return scope
    const received = new Date(now())
    const sender = senderOf(c, scope.project_id, received)
    const errorRows: QueuedError[] = []
    const others: QueuedReceived[] = []
    const keep = (kind: string, entry: (typeof batch.other)[number]) =>
      others.push(
        receivedRow(
          scope,
          { kind, body: { encoding: 'json', value: entry.item }, bytes: entry.bytes, at: entry.at },
          received,
        ),
      )
    for (const entry of batch.exceptions) {
      const row = await toErrorRow(scope, exceptionAsSentryEvent(entry), sender, received)
      // An exception with no type, message or stack is still something the app sent.
      if (row) errorRows.push(row)
      else keep('posthog.$exception', entry)
    }
    for (const entry of batch.other) keep(`posthog.${entry.name}`, entry)
    const failed = (await queue(c, 'errors', errorRows)) ?? (await queue(c, 'received', others))
    if (failed) return failed
    const accepted = await acceptEvents(c, scope, batch.events)
    return typeof accepted === 'number' ? c.json({ status: 1 }) : accepted
  }
  const posthogLimit = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: 'body_too_large' }, 413),
  })
  for (const path of ['/e', '/i/v0/e', '/batch', '/capture', '/track']) {
    app.post(path, posthogLimit, posthog)
    app.post(`${path}/`, posthogLimit, posthog)
  }
  /**
   * Person updates (`/engage/`, older SDKs). No area reads profiles yet, so
   * each is kept in `received`, its e-mail, phone and name masked.
   */
  const engage = async (c: Context) => {
    if (deps.sink.isFull('received')) return queueFull(c)
    let body: unknown
    try {
      body = parsePostHogBody({
        body: new Uint8Array(await c.req.arrayBuffer()),
        contentType: c.req.header('content-type'),
        contentEncoding: c.req.header('content-encoding'),
        compression: c.req.query('compression'),
      })
    } catch (err) {
      if (err instanceof UnsupportedCompression) {
        return c.json({ error: 'unsupported_compression' }, 400)
      }
      return c.json({ error: 'invalid_body' }, 400)
    }
    const items = (Array.isArray(body) ? body : [body]).filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && !Array.isArray(item),
    )
    const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
    const key =
      keyFrom(c) ??
      items.map((item) => text(item.$token) ?? text(item.token) ?? text(item.api_key)).find(Boolean)
    const scope = await scopeOf(c, key ?? '')
    if (scope instanceof Response) return scope
    const received = new Date(now())
    const rows = items.map((item) =>
      receivedRow(
        scope,
        {
          kind: 'posthog.$engage',
          body: { encoding: 'json', value: item },
          bytes: Buffer.byteLength(JSON.stringify(item)),
          at: timeOf(item.$time ?? item.timestamp),
        },
        received,
      ),
    )
    return (await queue(c, 'received', rows)) ?? c.json({ status: 1 })
  }
  for (const path of ['/engage', '/engage/']) app.post(path, posthogLimit, engage)
  for (const path of ['/flags', '/flags/', '/decide', '/decide/']) {
    app.on(['GET', 'POST'], path, (c) => c.json(POSTHOG_FLAGS))
  }
  app.get('/array/:token/config', (c) => c.json(POSTHOG_FLAGS))
  app.get('/array/:token/config.js', (c) =>
    c.body('window._POSTHOG_REMOTE_CONFIG=window._POSTHOG_REMOTE_CONFIG||{};', 200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300',
    }),
  )
  // The PostHog snippet loads the library from the host it sends to.
  app.get('/static/:file', (c) => {
    const file = c.req.param('file')
    if (!/^[\w.-]+\.js$/.test(file)) return c.json({ error: 'not_found' }, 404)
    return c.redirect(`${POSTHOG_ASSETS}${file}`, 302)
  })

  /**
   * Errors, from any Sentry SDK (`/api/<id>/envelope/` and the older
   * `/api/<id>/store/`) and from the Octadash script (`/o/v1/errors`, the same
   * event JSON, one or a list). The id in the address is ignored: the key
   * names the product and the source. Every other envelope item (sessions,
   * transactions, check-ins, feedback, client reports, replays, attachments,
   * and any type a future SDK sends) is kept in `received` as it came.
   */
  const errors = (format: 'envelope' | 'store' | 'octadash') => async (c: Context) => {
    if (['errors', 'received', 'spans', 'logs'].some((k) => deps.sink.isFull(k as 'errors'))) {
      return queueFull(c)
    }
    let body: Uint8Array
    try {
      body = inflate(new Uint8Array(await c.req.arrayBuffer()), c.req.header('content-encoding'))
    } catch {
      return c.json({ error: 'invalid_body' }, 400)
    }

    let events: unknown[]
    let dsn: string | undefined
    let others: EnvelopeItem[] = []
    let sentAt: Date | undefined
    try {
      if (format === 'envelope') {
        const envelope = parseEnvelope(body)
        dsn = typeof envelope.header.dsn === 'string' ? envelope.header.dsn : undefined
        sentAt = timeOf(envelope.header.sent_at)
        events = envelope.items
          .filter((item) => item.type === 'event')
          .map((item) => JSON.parse(new TextDecoder().decode(item.payload)))
        others = envelope.items.filter((item) => item.type !== 'event')
      } else {
        const parsed = JSON.parse(new TextDecoder().decode(body))
        if (format === 'octadash' && parsed && typeof parsed === 'object' && 'events' in parsed) {
          dsn = typeof parsed.key === 'string' ? parsed.key : undefined
          events = Array.isArray(parsed.events) ? parsed.events : []
        } else {
          events = Array.isArray(parsed) ? parsed : [parsed]
        }
      }
    } catch {
      return c.json({ error: 'invalid_json' }, 400)
    }

    const key =
      sentryKey(
        c.req.query('sentry_key'),
        c.req.header('x-sentry-auth'),
        c.req.header('authorization'),
        dsn,
      ) ?? keyFrom(c)
    const scope = await scopeOf(c, key ?? '')
    if (scope instanceof Response) return scope

    const received = new Date(now())
    const sender = senderOf(c, scope.project_id, received)
    const rows: QueuedError[] = []
    const kept: QueuedReceived[] = []
    const spans: OtlpSpan[] = []
    const logs: OtlpLog[] = []
    for (const item of others) {
      const content = bodyOf(item.payload)
      const value = content.encoding === 'json' ? content.value : undefined
      const facts =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : undefined
      let body = content
      // Tracing and logs go where OTLP's go; what is not a span stays as it came.
      if (facts && item.type === 'transaction') {
        spans.push(...transactionSpans(facts))
        const { spans: _children, ...rest } = facts
        body = { encoding: 'json', value: rest }
      } else if (facts && item.type === 'span') {
        spans.push(standaloneSpan(facts))
        continue
      } else if (facts && item.type === 'log') {
        logs.push(...sentryLogs(facts))
        continue
      }
      kept.push(
        receivedRow(
          scope,
          {
            kind: `sentry.${item.type || 'unknown'}`,
            meta: item.header,
            body,
            bytes: item.payload.length,
            at: timeOf(facts?.timestamp ?? facts?.started ?? facts?.start_timestamp) ?? sentAt,
          },
          received,
        ),
      )
    }
    for (const event of events.slice(0, MAX_ERRORS_PER_REQUEST)) {
      const row = await toErrorRow(scope, event, sender, received)
      // An event with no exception and no message is still kept, as it came.
      if (row) rows.push(row)
      else {
        const bytes = Buffer.byteLength(JSON.stringify(event) ?? '')
        kept.push(
          receivedRow(
            scope,
            { kind: 'sentry.event', body: { encoding: 'json', value: event }, bytes },
            received,
          ),
        )
      }
    }
    if (events.length > MAX_ERRORS_PER_REQUEST) {
      kept.push(
        droppedRow(
          scope,
          'error',
          'too_many_in_request',
          0,
          events.length - MAX_ERRORS_PER_REQUEST,
          received,
        ),
      )
    }
    const spanRows = toSpanRows(scope, spans, received)
    const logRows = toLogRows(scope, logs, received)
    const lost = spans.length - spanRows.length
    if (lost > 0) kept.push(droppedRow(scope, 'sentry.span', 'invalid_span_id', 0, lost, received))
    const failed =
      (await queue(c, 'errors', rows)) ??
      (await queue(c, 'spans', spanRows)) ??
      (await queue(c, 'logs', logRows)) ??
      (await queue(c, 'received', kept))
    if (failed) return failed
    // Sentry SDKs read the event id back.
    return c.json(
      format === 'octadash' ? { accepted: rows.length } : { id: rows[0]?.event_id ?? null },
    )
  }
  const errorLimit = (max: number) =>
    bodyLimit({ maxSize: max, onError: (c) => c.json({ error: 'body_too_large' }, 413) })
  for (const path of ['/api/:id/envelope/', '/api/:id/envelope']) {
    app.post(path, errorLimit(MAX_ENVELOPE_BYTES), errors('envelope'))
  }
  for (const path of ['/api/:id/store/', '/api/:id/store']) {
    app.post(path, errorLimit(MAX_BODY_BYTES), errors('store'))
  }
  app.post('/o/v1/errors', errorLimit(MAX_BODY_BYTES), errors('octadash'))

  /**
   * OpenTelemetry over HTTP, protobuf or JSON. The key comes in a header
   * (`x-octadash-key` or `Authorization: Bearer`). Logs, spans and metric
   * points are masked and queued; what a request holds beyond the limits is
   * answered as rejected, so the SDK knows.
   */
  const otlp = (kind: 'logs' | 'spans' | 'dataPoints') => async (c: Context) => {
    const encoding = (c.req.header('content-type') ?? '').includes('json') ? 'json' : 'protobuf'
    const answer = (rejected: number, message: string) => {
      const out = exportAnswer(rejected, message, encoding, kind)
      return c.body(out.body as never, 200, { 'content-type': out.contentType })
    }
    const stream = kind === 'dataPoints' ? 'metrics' : kind
    if (deps.sink.isFull(stream)) return queueFull(c)
    const scope = await scopeOf(c, keyFrom(c) ?? '')
    if (scope instanceof Response) return scope

    let decoded: OtlpLog[] | OtlpSpan[] | OtlpPoint[]
    try {
      const body = inflate(
        new Uint8Array(await c.req.arrayBuffer()),
        c.req.header('content-encoding'),
      )
      const json = () => JSON.parse(new TextDecoder().decode(body))
      if (kind === 'logs') {
        decoded = encoding === 'json' ? decodeLogsJson(json()) : decodeLogsProtobuf(body)
      } else if (kind === 'spans') {
        decoded = encoding === 'json' ? decodeTracesJson(json()) : decodeTracesProtobuf(body)
      } else {
        decoded = encoding === 'json' ? decodeMetricsJson(json()) : decodeMetricsProtobuf(body)
      }
    } catch {
      return c.json({ error: 'invalid_body' }, 400)
    }
    if (decoded.length === 0) return answer(0, '')
    const received = new Date(now())
    const rows =
      kind === 'logs'
        ? toLogRows(scope, decoded as OtlpLog[], received)
        : kind === 'spans'
          ? toSpanRows(scope, decoded as OtlpSpan[], received)
          : toMetricRows(scope, decoded as OtlpPoint[], received)
    try {
      // Large batches go in pieces, so one stream entry stays small.
      for (let i = 0; i < rows.length; i += 1000) {
        await deps.sink.write(stream, rows.slice(i, i + 1000))
      }
    } catch (err) {
      deps.onError?.(err)
      return c.json({ error: 'unavailable' }, 503, { 'retry-after': '5' })
    }
    const rejected = decoded.length - rows.length
    const limit = {
      logs: `${MAX_LOGS_PER_REQUEST} log records per request`,
      spans: `${MAX_SPANS_PER_REQUEST} spans per request, each with a valid trace and span id`,
      dataPoints: `${MAX_POINTS_PER_REQUEST} data points per request, each with a metric name`,
    }[kind]
    return answer(rejected, rejected > 0 ? `At most ${limit}.` : '')
  }
  const otlpLimit = errorLimit(MAX_ENVELOPE_BYTES)
  for (const prefix of ['', '/otlp']) {
    app.post(`${prefix}/v1/logs`, otlpLimit, otlp('logs'))
    app.post(`${prefix}/v1/traces`, otlpLimit, otlp('spans'))
    app.post(`${prefix}/v1/metrics`, otlpLimit, otlp('dataPoints'))
  }

  app.notFound((c) => c.json({ error: 'not_found' }, 404))

  app.onError((err, c) => {
    deps.onError?.(err)
    return c.json({ error: 'internal' }, 500)
  })

  return app
}

function keyFrom(c: Context): string | undefined {
  const header = c.req.header('x-octadash-key')
  if (header) return header.trim()
  const auth = c.req.header('authorization')
  return auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
}

/** The body as sent, decompressed when the SDK compressed it (Sentry's Python and others do). */
function inflate(body: Uint8Array, encoding: string | undefined): Uint8Array {
  const options = { maxOutputLength: MAX_INFLATED_BYTES }
  switch (encoding?.trim().toLowerCase()) {
    case 'gzip':
      return gunzipSync(body, options)
    case 'deflate':
      return inflateSync(body, options)
    case 'br':
      return brotliDecompressSync(body, options)
    default:
      return body
  }
}

function queueFull(c: Context) {
  return c.json({ error: 'queue_full' }, 429, { 'retry-after': String(RETRY_AFTER_SECONDS) })
}
