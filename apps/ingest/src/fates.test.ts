import { DROPPED_PREFIX, type QueuedReceived } from '@octadash/db'
import { MemoryHeartbeats, MemorySalts, MemorySink } from '@octadash/queue'
import { MemoryFileStore } from '@octadash/storage'
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

function setup(files: MemoryFileStore | null = new MemoryFileStore()) {
  const sink = new MemorySink()
  const app = createApp({
    sink,
    files: files ?? undefined,
    keys: staticResolver({ [KEY]: scope }),
    heartbeats: { resolver: { resolve: async () => null }, store: new MemoryHeartbeats() },
    salts: new MemorySalts(),
    now: () => 1_795_000_000_000,
  })
  const rows = (kind: string) => sink.batches.filter((b) => b.kind === kind).flatMap((b) => b.rows)
  const received = () => rows('received') as QueuedReceived[]
  return { app, sink, rows, received, files }
}

/** Every Sentry envelope item type in the protocol today, and one from the future. */
const SENTRY_ITEMS: [type: string, body: string][] = [
  [
    'session',
    '{"sid":"s1","did":"ana@example.com","status":"ok","started":"2026-11-28T10:00:00Z"}',
  ],
  ['sessions', '{"aggregates":[{"started":"2026-11-28T10:00:00Z","exited":3}]}'],
  [
    'transaction',
    `{"type":"transaction","transaction":"/checkout","start_timestamp":1795000000,"timestamp":1795000001,"contexts":{"trace":{"trace_id":"${'1'.repeat(32)}","span_id":"${'2'.repeat(16)}","op":"http.server"}},"spans":[{"span_id":"${'3'.repeat(16)}","parent_span_id":"${'2'.repeat(16)}","op":"db","description":"select"}]}`,
  ],
  ['span', `{"span_id":"${'4'.repeat(16)}","trace_id":"${'1'.repeat(32)}","op":"http"}`],
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
    // Spans and logs go where OTLP's go; a transaction also keeps what is not a span.
    expect(rows('spans')).toHaveLength(3)
    expect(rows('logs')).toHaveLength(1)
    expect(received().map((row) => row.kind)).toEqual(
      SENTRY_ITEMS.filter(([type]) => type !== 'span' && type !== 'log').map(
        ([type]) => `sentry.${type}`,
      ),
    )
    expect(received().find((row) => row.kind === 'sentry.transaction')?.payload).not.toContain(
      'select',
    )
    const session = received().find((row) => row.kind === 'sentry.session')
    expect(session?.payload).not.toContain('ana@example.com')
    expect(session?.payload).toContain(personId(scope.project_id, 'ana@example.com'))
    const report = received().find((row) => row.kind === 'sentry.user_report')
    expect(report?.payload).toContain('broke')
    expect(report?.payload).not.toContain('Ana')
    // Replays, profiles and attachments are files, kept whole in file storage.
    for (const type of ['replay_recording', 'replay_video', 'attachment', 'profile']) {
      expect(received().find((row) => row.kind === `sentry.${type}`)?.encoding).toBe('file')
    }
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

  it('keeps a file whole in file storage, masked like a row', async () => {
    const { app, received, files } = setup()
    const big = JSON.stringify({ note: 'x'.repeat(MAX_RECEIVED_BYTES), email: 'ana@example.com' })
    const res = await app.request(`/api/1/envelope/?sentry_key=${KEY}`, {
      method: 'POST',
      body: `{}\n{"type":"attachment","filename":"state.json","content_type":"application/json"}\n${big}\n`,
    })
    expect(res.status).toBe(200)
    const row = received()[0]
    expect(row?.encoding).toBe('file')
    const { meta, file } = JSON.parse(row?.payload ?? '{}')
    expect(meta).toMatchObject({ filename: 'state.json' })
    expect(file.key).toMatch(/^files\/\d{4}-\d{2}-\d{2}\/[\w-]+\/[\w-]+\/sentry\.attachment\//)
    expect(file.content_type).toBe('application/json')
    const stored = files?.files.get(file.key)
    expect(stored?.body.length).toBe(file.bytes)
    const text = new TextDecoder().decode(stored?.body)
    expect(text).toContain('x'.repeat(1000))
    expect(text).not.toContain('ana@example.com')
  })

  it('keeps small files in the row when file storage is down, and counts big ones', async () => {
    const files = new MemoryFileStore()
    files.failing = true
    const { app, received } = setup(files)
    await app.request(`/api/1/envelope/?sentry_key=${KEY}`, {
      method: 'POST',
      body: `{}\n{"type":"attachment"}\nsmall\n{"type":"attachment"}\n${'x'.repeat(MAX_RECEIVED_BYTES + 1)}\n`,
    })
    expect(received().map((row) => [row.kind, row.encoding])).toEqual([
      ['sentry.attachment', 'text'],
      ['dropped:sentry.attachment', 'json'],
    ])
    expect(JSON.parse(received()[1]?.payload ?? '{}')).toEqual({
      reason: 'storage_unavailable',
      count: 1,
    })
  })

  it('counts what it leaves out instead of losing it silently', async () => {
    // No file storage set: an item over 1 MB cannot be kept.
    const { app, received } = setup(null)
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
