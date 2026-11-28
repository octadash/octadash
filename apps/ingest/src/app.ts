import { OCTADASH_VERSION } from '@octadash/core'
import type { EventSink, HeartbeatStore } from '@octadash/queue'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { batchSchema, PropertiesTooLargeError, toEventRows } from './events'
import type { HeartbeatResolver, KeyResolver } from './keys'

/** Requests bigger than this are refused before they are read. */
export const MAX_BODY_BYTES = 1024 * 1024
/** Seconds an SDK should wait when the queue is full. */
const RETRY_AFTER_SECONDS = 30

export interface IngestDeps {
  sink: EventSink
  keys: KeyResolver
  heartbeats: { resolver: HeartbeatResolver; store: HeartbeatStore }
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
 *   - PostHog capture       /e/, /i/v0/e/, /batch/, /capture/   (later steps)
 *   - OpenTelemetry (OTLP)  /v1/logs, /v1/traces               (later steps)
 * Heartbeat monitors ping /hb/<token> (GET or POST) from cron jobs and backups.
 * The health check touches nothing, so uptime probes never wake a database.
 */
export function createApp(deps: IngestDeps) {
  const app = new Hono()

  // SDKs call ingest from browsers on other domains.
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['content-type', 'authorization', 'x-octadash-key'],
      maxAge: 86_400,
    }),
  )

  app.get('/health', (c) => c.json({ status: 'ok', service: 'ingest', version: OCTADASH_VERSION }))

  // A cron job or backup reports that it ran. The token is the secret; the
  // ping is kept in Valkey and the worker compares it with the monitor's interval.
  const heartbeat = async (c: Context) => {
    const token = c.req.param('token') ?? ''
    let monitorId: string | null
    try {
      monitorId = await deps.heartbeats.resolver.resolve(token)
      if (monitorId) await deps.heartbeats.store.record(monitorId, (deps.now ?? Date.now)())
    } catch (err) {
      deps.onError?.(err)
      return c.json({ error: 'unavailable' }, 503)
    }
    if (!monitorId) return c.json({ error: 'unknown_heartbeat' }, 404)
    return c.json({ ok: true })
  }
  app.get('/hb/:token', heartbeat)
  app.post('/hb/:token', heartbeat)

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

      const key = keyFrom(c) ?? parsed.data.key ?? ''
      let scope: Awaited<ReturnType<KeyResolver['resolve']>>
      try {
        scope = await deps.keys.resolve(key)
      } catch (err) {
        deps.onError?.(err)
        return c.json({ error: 'unavailable' }, 503)
      }
      if (!scope) return c.json({ error: 'invalid_key' }, 401)

      let rows: ReturnType<typeof toEventRows>
      try {
        rows = toEventRows(scope, parsed.data.events)
      } catch (err) {
        if (err instanceof PropertiesTooLargeError) {
          return c.json({ error: 'properties_too_large', event: err.message }, 400)
        }
        throw err
      }

      try {
        await deps.sink.write('events', rows)
      } catch (err) {
        deps.onError?.(err)
        return c.json({ error: 'unavailable' }, 503, { 'retry-after': '5' })
      }
      return c.json({ accepted: rows.length }, 202)
    },
  )

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

function queueFull(c: Context) {
  return c.json({ error: 'queue_full' }, 429, { 'retry-after': String(RETRY_AFTER_SECONDS) })
}
