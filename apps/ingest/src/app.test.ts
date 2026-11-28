import { MemoryHeartbeats, MemorySalts, MemorySink } from '@octadash/queue'
import { describe, expect, it } from 'vitest'
import { createApp, MAX_BODY_BYTES } from './app'
import { staticResolver } from './keys'

const KEY = 'a'.repeat(32)
const PERSISTENT = 'd'.repeat(32)
const TOKEN = 'T'.repeat(32)
const MONITOR = '00000000-0000-4000-8000-0000000000c1'
const scope = {
  org_id: '00000000-0000-4000-8000-00000000000a',
  project_id: '00000000-0000-4000-8000-0000000000b1',
  source_id: '00000000-0000-4000-8000-0000000000c1',
  visitor_mode: 'daily' as const,
}

function setup() {
  const sink = new MemorySink()
  const pings = new MemoryHeartbeats()
  const app = createApp({
    sink,
    keys: staticResolver({
      [KEY]: scope,
      [PERSISTENT]: { ...scope, visitor_mode: 'persistent' },
    }),
    heartbeats: {
      resolver: { resolve: async (token) => (token === TOKEN ? MONITOR : null) },
      store: pings,
    },
    salts: new MemorySalts(),
    now: () => 1_795_000_000_000,
  })
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/o/v1/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  return { app, sink, pings, post }
}

describe('ingest app', () => {
  it('answers the health check without a database', async () => {
    const res = await setup().app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'ingest' })
  })

  it('serves the browser script', async () => {
    const res = await setup().app.request('/o/v1/script.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
    const body = await res.text()
    expect(body).toContain('$pageview')
    expect(body.length).toBeLessThan(4500)
  })

  it('allows cross-origin calls from SDKs', async () => {
    const res = await setup().app.request('/health', {
      headers: { origin: 'https://postato.com.br' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('records heartbeat pings by GET and POST, and refuses unknown tokens', async () => {
    const { app, pings } = setup()
    expect((await app.request(`/hb/${TOKEN}`)).status).toBe(200)
    expect((await app.request(`/hb/${TOKEN}`, { method: 'POST', body: 'x' })).status).toBe(200)
    expect(pings.pings.get(MONITOR)).toBe(1_795_000_000_000)
    expect((await app.request(`/hb/${'U'.repeat(32)}`)).status).toBe(404)
    expect(pings.pings.size).toBe(1)
  })

  it('records a failure reported on /fail, under both addresses', async () => {
    const { app, pings } = setup()
    expect((await app.request(`/o/v1/hb/${TOKEN}`)).status).toBe(200)
    expect((await app.request(`/o/v1/hb/${TOKEN}/fail`, { method: 'POST' })).status).toBe(200)
    expect(pings.failures.get(MONITOR)).toBe(1_795_000_000_000)
    expect((await app.request(`/hb/${'U'.repeat(32)}/fail`)).status).toBe(404)
  })

  it('returns JSON 404 for unknown routes', async () => {
    const res = await setup().app.request('/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })
})

describe('POST /o/v1/events', () => {
  it('queues the batch and answers 202 at once', async () => {
    const { sink, post } = setup()
    const res = await post(
      {
        events: [
          {
            event: 'pageview',
            timestamp: '2026-11-18T10:00:00.000Z',
            distinct_id: 'u1',
            properties: { path: '/' },
          },
          { event: 'signup.completed' },
        ],
      },
      { 'x-octadash-key': KEY },
    )
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ accepted: 2 })
    expect(sink.batches).toHaveLength(1)
    expect(sink.batches[0]?.kind).toBe('events')
    expect(sink.batches[0]?.rows[0]).toMatchObject({
      org_id: scope.org_id,
      project_id: scope.project_id,
      source_id: scope.source_id,
      event: 'pageview',
      timestamp: '2026-11-18 10:00:00.000',
      distinct_id: 'u1',
      session_id: '',
      properties: '{"path":"/"}',
    })
    expect(sink.batches[0]?.rows[1]).toMatchObject({ event: 'signup.completed', properties: '{}' })
  })

  it('reads page, origin of the visit, browser and country, and hashes the visitor', async () => {
    const { sink, post } = setup()
    const browser = {
      'x-octadash-key': KEY,
      origin: 'https://www.postato.com.br',
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
      'cf-ipcountry': 'br',
      'user-agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    }
    const pageview = {
      event: '$pageview',
      properties: {
        $current_url: 'https://www.postato.com.br/precos?utm_source=Instagram&utm_medium=social',
        $referrer: 'https://l.instagram.com/',
      },
    }
    await post({ events: [pageview] }, browser)
    await post({ events: [pageview] }, browser)
    await post({ events: [pageview] }, { ...browser, 'x-forwarded-for': '198.51.100.9' })
    await post({ events: [{ event: 'signup.completed' }] }, { 'x-octadash-key': KEY })
    const rows = sink.batches.map((batch) => batch.rows[0] as Record<string, unknown>)
    expect(rows[0]).toMatchObject({
      path: '/precos',
      host: 'postato.com.br',
      referrer_host: 'l.instagram.com',
      utm_source: 'instagram',
      utm_medium: 'social',
      browser: 'Safari',
      os: 'iOS',
      device: 'mobile',
      country: 'BR',
      is_bot: 0,
    })
    expect(rows[0]?.visitor_id).toMatch(/^[0-9a-f]{32}$/)
    expect(rows[1]?.visitor_id).toBe(rows[0]?.visitor_id)
    expect(rows[2]?.visitor_id).not.toBe(rows[0]?.visitor_id)
    // A server call without $ip speaks for nobody.
    expect(rows[3]).toMatchObject({ visitor_id: '', browser: '', path: '' })
  })

  it('counts a returning visitor by the browser id only where the source allows it', async () => {
    const { sink, post } = setup()
    const browser = { origin: 'https://postato.com.br', 'user-agent': 'Mozilla/5.0 Firefox/140.0' }
    const pageview = (id: string) => ({
      events: [
        {
          event: '$pageview',
          properties: { $visitor_id: id, $current_url: 'https://postato.com.br/' },
        },
      ],
    })
    const id = 'c'.repeat(32)
    await post(pageview(id), {
      ...browser,
      'x-octadash-key': PERSISTENT,
      'x-forwarded-for': '203.0.113.7',
    })
    await post(pageview(id), {
      ...browser,
      'x-octadash-key': PERSISTENT,
      'x-forwarded-for': '198.51.100.9',
    })
    await post(pageview('not-an-id'), {
      ...browser,
      'x-octadash-key': PERSISTENT,
      'x-forwarded-for': '198.51.100.9',
    })
    await post(pageview(id), {
      ...browser,
      'x-octadash-key': KEY,
      'x-forwarded-for': '198.51.100.9',
    })
    const rows = sink.batches.map((batch) => batch.rows[0] as Record<string, unknown>)
    // Same browser id from two addresses: one visitor, and not the id as sent.
    expect(rows[1]?.visitor_id).toBe(rows[0]?.visitor_id)
    expect(rows[0]?.visitor_id).toMatch(/^[0-9a-f]{32}$/)
    expect(rows[0]?.visitor_id).not.toBe(id)
    // A malformed id, or a source that counts by the day, falls back to the daily hash.
    expect(rows[2]?.visitor_id).not.toBe(rows[0]?.visitor_id)
    expect(rows[3]?.visitor_id).toBe(rows[2]?.visitor_id)
    // The id itself is never stored.
    for (const row of rows) expect(row.properties).not.toContain('$visitor_id')
  })

  it('takes the key from a bearer header or from the body (sendBeacon)', async () => {
    const { sink, post } = setup()
    expect(
      (await post({ events: [{ event: 'a' }] }, { authorization: `Bearer ${KEY}` })).status,
    ).toBe(202)
    const beacon = await post(JSON.stringify({ key: KEY, events: [{ event: 'b' }] }), {
      'content-type': 'text/plain',
    })
    expect(beacon.status).toBe(202)
    expect(sink.batches).toHaveLength(2)
  })

  it('refuses unknown keys', async () => {
    const res = await setup().post({ key: 'b'.repeat(32), events: [{ event: 'a' }] })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'invalid_key' })
  })

  it('explains invalid bodies', async () => {
    const { post } = setup()
    expect((await post('not json', { 'x-octadash-key': KEY })).status).toBe(400)
    const res = await post({ events: [{ event: '' }] }, { 'x-octadash-key': KEY })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: 'invalid_body',
      issues: [{ path: 'events.0.event' }],
    })
  })

  it('refuses oversized properties and bodies', async () => {
    const { post } = setup()
    const big = { events: [{ event: 'a', properties: { x: 'y'.repeat(40_000) } }] }
    const res = await post(big, { 'x-octadash-key': KEY })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'properties_too_large' })
    const huge = await post('x'.repeat(MAX_BODY_BYTES + 1), { 'x-octadash-key': KEY })
    expect(huge.status).toBe(413)
  })

  it('answers 429 with Retry-After when the worker is far behind', async () => {
    const { sink, post } = setup()
    sink.full = true
    const res = await post({ events: [{ event: 'a' }] }, { 'x-octadash-key': KEY })
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('30')
    expect(sink.batches).toHaveLength(0)
  })

  it('answers 503 when Valkey is unreachable, so the SDK retries', async () => {
    const { sink, post } = setup()
    sink.failing = true
    const res = await post({ events: [{ event: 'a' }] }, { 'x-octadash-key': KEY })
    expect(res.status).toBe(503)
  })
})

describe('event time', () => {
  it('uses the arrival time for events dated more than an hour ahead', async () => {
    const { sink, post } = setup()
    const ahead = new Date(Date.now() + 2 * 3_600_000).toISOString()
    await post({ events: [{ event: 'a', timestamp: ahead }] }, { 'x-octadash-key': KEY })
    const row = sink.batches[0]?.rows[0] as { timestamp: string; received_at: string }
    expect(row.timestamp).toBe(row.received_at)
  })
})
