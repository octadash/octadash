import { DROPPED_PREFIX, type QueuedReceived } from '@octadash/db'
import { MemoryHeartbeats, MemorySalts, MemorySink } from '@octadash/queue'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { ROUTES } from './fates'
import { staticResolver } from './keys'
import { EXCEPTION_EVENT, NOT_PRODUCT_EVENTS } from './posthog'
import { personId } from './privacy'
import { MAX_RECEIVED_BYTES } from './received'

/**
 * The rule of fates.ts: what arrives is kept. These tests fail when a route
 * has no declared fate, or when a kind of data stops reaching a stream.
 */

const KEY = 'a'.repeat(32)
const scope = {
  org_id: '00000000-0000-4000-8000-00000000000a',
  project_id: '00000000-0000-4000-8000-0000000000b1',
  source_id: '00000000-0000-4000-8000-0000000000c1',
  visitor_mode: 'daily' as const,
}

function setup() {
  const sink = new MemorySink()
  const app = createApp({
    sink,
    keys: staticResolver({ [KEY]: scope }),
    heartbeats: { resolver: { resolve: async () => null }, store: new MemoryHeartbeats() },
    salts: new MemorySalts(),
    now: () => 1_795_000_000_000,
  })
  const rows = (kind: string) => sink.batches.filter((b) => b.kind === kind).flatMap((b) => b.rows)
  const received = () => rows('received') as QueuedReceived[]
  return { app, sink, rows, received }
}

/** Every Sentry envelope item type in the protocol today, and one from the future. */
const SENTRY_ITEMS: [type: string, body: string][] = [
  [
    'session',
    '{"sid":"s1","did":"ana@example.com","status":"ok","started":"2026-11-28T10:00:00Z"}',
  ],
  ['sessions', '{"aggregates":[{"started":"2026-11-28T10:00:00Z","exited":3}]}'],
  ['transaction', '{"type":"transaction","transaction":"/checkout","spans":[]}'],
  ['span', '{"span_id":"a1","trace_id":"b2","op":"http"}'],
  ['check_in', '{"check_in_id":"c1","monitor_slug":"backup","status":"ok"}'],
  ['user_report', '{"event_id":"e1","name":"Ana","email":"ana@example.com","comments":"broke"}'],
  ['feedback', '{"contexts":{"feedback":{"message":"slow","contact_email":"a@b.co"}}}'],
  [
    'client_report',
    '{"discarded_events":[{"reason":"ratelimit_backoff","category":"error","quantity":4}]}',
  ],
  ['statsd', 'page.load@millisecond:120|d'],
  ['metric_buckets', '{}'],
  ['log', '{"items":[{"level":"info","body":"hi"}]}'],
  ['otel_log', '{"body":"hi"}'],
  ['profile', '{"version":"1","profile":{}}'],
  ['profile_chunk', '{"chunk_id":"p1"}'],
  ['replay_event', '{"replay_id":"r1","segment_id":0}'],
  ['replay_recording', 'BINARY'],
  ['replay_video', 'BINARY'],
  ['attachment', 'plain text attachment'],
  ['a_type_from_2030', '{"new":true}'],
]

describe('fates', () => {
  it('declares a fate for every route, and lists no route that does not exist', () => {
    const { app } = setup()
    const registered = new Set(
      app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`),
    )
    const missing = [...registered].filter((route) => !(route in ROUTES))
    const stale = Object.keys(ROUTES).filter((route) => !registered.has(route))
    expect(missing, 'add these routes to ROUTES in fates.ts').toEqual([])
    expect(stale, 'remove these from ROUTES in fates.ts').toEqual([])
  })

  it('keeps every Sentry envelope item, including types it has never seen', async () => {
    const { app, rows, received } = setup()
    const event = JSON.stringify({ exception: { values: [{ type: 'TypeError', value: 'x' }] } })
    // Binary items say their length, as SDKs do; their bytes are not UTF-8.
    const binary = Buffer.from([0x1f, 0x8b, 0xff, 0x00, 0xfe])
    const parts: Buffer[] = [
      Buffer.from(`{"dsn":"https://${KEY}@ingest.example/1"}\n{"type":"event"}\n${event}\n`),
    ]
    for (const [type, body] of SENTRY_ITEMS) {
      parts.push(
        body === 'BINARY'
          ? Buffer.concat([
              Buffer.from(`{"type":"${type}","length":${binary.length}}\n`),
              binary,
              Buffer.from('\n'),
            ])
          : Buffer.from(`{"type":"${type}"}\n${body}\n`),
      )
    }
    const res = await app.request('/api/1/envelope/', {
      method: 'POST',
      body: Buffer.concat(parts),
    })
    expect(res.status).toBe(200)
    expect(rows('errors')).toHaveLength(1)
    expect(received().map((row) => row.kind)).toEqual(
      SENTRY_ITEMS.map(([type]) => `sentry.${type}`),
    )
    const session = received().find((row) => row.kind === 'sentry.session')
    expect(session?.payload).not.toContain('ana@example.com')
    expect(session?.payload).toContain(personId(scope.project_id, 'ana@example.com'))
    const report = received().find((row) => row.kind === 'sentry.user_report')
    expect(report?.payload).toContain('broke')
    expect(report?.payload).not.toContain('Ana')
    expect(received().find((row) => row.kind === 'sentry.replay_recording')?.encoding).toBe(
      'base64',
    )
    expect(received().find((row) => row.kind === 'sentry.statsd')?.encoding).toBe('text')
  })

  it('keeps every PostHog event: product events, exceptions, the rest and new ones', async () => {
    const { app, rows, received } = setup()
    const names = [...NOT_PRODUCT_EVENTS, EXCEPTION_EVENT, '$a_new_one', 'signed_up']
    const batch = names.map((event) => ({
      event,
      distinct_id: 'user-1',
      properties:
        event === EXCEPTION_EVENT
          ? { $exception_list: [{ type: 'Error', value: 'boom' }] }
          : event === '$set'
            ? { $set: { email: 'ana@example.com', name: 'Ana Souza', plan: 'pro' } }
            : { x: 1 },
    }))
    const res = await app.request('/batch/', {
      method: 'POST',
      body: JSON.stringify({ api_key: KEY, batch }),
    })
    expect(res.status).toBe(200)
    const kept = [
      ...(rows('events') as { event: string }[]).map((row) => row.event),
      ...(rows('errors') as { value: string }[]).map(() => EXCEPTION_EVENT),
      ...received().map((row) => row.kind.replace(/^posthog\./, '')),
    ]
    expect(kept.sort()).toEqual([...names].sort())
    expect((rows('errors')[0] as { value: string }).value).toBe('boom')
    const set = received().find((row) => row.kind === 'posthog.$set')
    expect(set?.payload).toContain('pro')
    expect(set?.payload).not.toContain('ana@example.com')
    expect(set?.payload).not.toContain('Ana Souza')
    expect(set?.payload).not.toContain(KEY)
  })

  it('keeps person updates sent to /engage/', async () => {
    const { app, received } = setup()
    const res = await app.request('/engage/', {
      method: 'POST',
      body: JSON.stringify({ $token: KEY, $distinct_id: 'u1', $set: { plan: 'pro', $phone: '1' } }),
    })
    expect(res.status).toBe(200)
    expect(received()).toHaveLength(1)
    expect(received()[0]?.payload).toContain('pro')
    expect(received()[0]?.payload).not.toContain('"1"')
  })

  it('counts what it leaves out instead of losing it silently', async () => {
    const { app, received } = setup()
    const events = Array.from({ length: 105 }, () => ({ message: 'x' }))
    await app.request('/o/v1/errors', {
      method: 'POST',
      body: JSON.stringify({ key: KEY, events }),
    })
    const big = 'x'.repeat(MAX_RECEIVED_BYTES + 1)
    await app.request(`/api/1/envelope/?sentry_key=${KEY}`, {
      method: 'POST',
      body: `{}\n{"type":"attachment"}\n${big}\n`,
    })
    const dropped = received().filter((row) => row.kind.startsWith(DROPPED_PREFIX))
    expect(dropped.map((row) => [row.kind, JSON.parse(row.payload)])).toEqual([
      ['dropped:error', { reason: 'too_many_in_request', count: 5 }],
      ['dropped:sentry.attachment', { reason: 'too_large', count: 1 }],
    ])
  })
})
