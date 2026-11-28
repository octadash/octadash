import { gzipSync } from 'node:zlib'
import { MemoryHeartbeats, MemorySalts, MemorySink } from '@octadash/queue'
import { describe, expect, it } from 'vitest'
import { createApp, MAX_BODY_BYTES } from './app'
import { staticResolver } from './keys'
import { personId } from './privacy'

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
    expect(body.length).toBeLessThan(5000)
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
      distinct_id: personId(scope.project_id, 'u1'),
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

describe('privacy at the door', () => {
  it('keeps the person as a hash and drops properties that look personal', async () => {
    const { sink, post } = setup()
    await post(
      {
        events: [
          {
            event: 'signed_up',
            distinct_id: 'user-42',
            properties: {
              plan: 'pro',
              email: 'ana@shop.example',
              userPhone: '+55 11 99999-0000',
              note: 'write to ana@shop.example',
              tax_id: '123.456.789-09',
              company: { cnpj: '12.345.678/0001-90', size: 12 },
            },
          },
        ],
      },
      { 'x-octadash-key': KEY },
    )
    const row = sink.batches[0]?.rows[0] as { distinct_id: string; properties: string }
    expect(row.distinct_id).toMatch(/^[0-9a-f]{32}$/)
    expect(row.distinct_id).not.toBe('user-42')
    expect(JSON.parse(row.properties)).toEqual({ plan: 'pro', company: { size: 12 } })
  })
})

describe('PostHog SDKs', () => {
  const posthogEvent = (event: string, extra: Record<string, unknown> = {}) => ({
    event,
    timestamp: '2026-11-18T10:00:00.000Z',
    uuid: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    properties: {
      token: KEY,
      distinct_id: 'anon-1',
      $device_id: 'anon-1',
      $session_id: 's-1',
      $current_url: 'https://shop.example/pricing',
      plan: 'pro',
      ...extra,
    },
  })

  it('takes posthog-js batches, gzipped, and drops what Octadash does not keep', async () => {
    const { app, sink } = setup()
    const body = gzipSync(
      JSON.stringify([
        posthogEvent('$pageview'),
        posthogEvent('signed_up', { $set: { email: 'ana@shop.example' } }),
        posthogEvent('$autocapture'),
      ]),
    )
    // Recent posthog-js gzips without naming it anywhere.
    const res = await app.request('/e/', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin: 'https://shop.example' },
      body,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 1 })
    const rows = sink.batches[0]?.rows as {
      event: string
      distinct_id: string
      session_id: string
      uuid: string
      properties: string
      path: string
    }[]
    expect(rows.map((r) => r.event)).toEqual(['$pageview', 'signed_up'])
    expect(rows[1]).toMatchObject({
      distinct_id: personId(scope.project_id, 'anon-1'),
      session_id: 's-1',
      uuid: '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      path: '/pricing',
    })
    const properties = JSON.parse(rows[1]?.properties ?? '{}')
    expect(properties).toMatchObject({ plan: 'pro' })
    expect(properties).not.toHaveProperty('$set')
    expect(properties).not.toHaveProperty('$device_id')
    expect(properties).not.toHaveProperty('token')
  })

  it('takes server batches with api_key, and the form posthog-js used before', async () => {
    const { app, sink } = setup()
    const batch = await app.request('/batch/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: KEY,
        batch: [{ event: 'payment.confirmed', distinct_id: 'u-9', properties: { amount: 10 } }],
      }),
    })
    expect(batch.status).toBe(200)
    expect(sink.batches[0]?.rows[0]).toMatchObject({
      event: 'payment.confirmed',
      distinct_id: personId(scope.project_id, 'u-9'),
    })

    const form = new URLSearchParams({
      data: Buffer.from(JSON.stringify(posthogEvent('invite_sent'))).toString('base64'),
    })
    const res = await app.request('/i/v0/e/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    expect(res.status).toBe(200)
    expect(sink.batches[1]?.rows[0]).toMatchObject({ event: 'invite_sent' })
  })

  it('refuses a wrong key and lz-string bodies', async () => {
    const { app } = setup()
    const wrong = await app.request('/capture/', {
      method: 'POST',
      body: JSON.stringify({ api_key: 'nope', event: 'x', distinct_id: 'a' }),
    })
    expect(wrong.status).toBe(401)
    const lz = await app.request('/e/?compression=lz64', { method: 'POST', body: 'data=abc' })
    expect(lz.status).toBe(400)
  })

  it('answers flags with everything off and points the snippet to the library', async () => {
    const { app } = setup()
    const flags = await app.request('/flags/?v=2', { method: 'POST', body: '{}' })
    expect(await flags.json()).toMatchObject({
      featureFlags: {},
      autocapture_opt_out: true,
      sessionRecording: false,
    })
    const script = await app.request('/static/array.js')
    expect(script.status).toBe(302)
    expect(script.headers.get('location')).toContain('/static/array.js')
    expect((await app.request('/static/..%2Fx')).status).toBe(404)
  })
})

describe('OpenTelemetry logs', () => {
  const request = (records: Record<string, unknown>[]) => ({
    resourceLogs: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'api' } }] },
        scopeLogs: [{ logRecords: records }],
      },
    ],
  })

  it('queues lines with the level, service and masking, under /v1 and /otlp/v1', async () => {
    const { app, sink } = setup()
    for (const path of ['/v1/logs', '/otlp/v1/logs']) {
      const res = await app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-octadash-key': KEY },
        body: JSON.stringify(
          request([
            {
              timeUnixNano: '1794999990000000000',
              severityText: 'Information',
              body: { stringValue: 'Paid by ana@shop.example' },
              attributes: [{ key: 'password', value: { stringValue: 'hunter2' } }],
            },
          ]),
        ),
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({})
    }
    expect(sink.batches).toHaveLength(2)
    const row = (sink.batches[0]?.rows as Record<string, unknown>[] | undefined)?.[0]
    expect(row).toMatchObject({
      project_id: scope.project_id,
      source_id: scope.source_id,
      timestamp: '2026-11-18 11:06:30.000000000',
      level: 'info',
      severity_number: 9,
      service: 'api',
      body: 'Paid by [email]',
      attributes: { password: '[secret]' },
      masked: 2,
    })
    expect(sink.batches[0]?.kind).toBe('logs')
  })

  it('takes the key as a bearer token and gzip bodies, and refuses without a key', async () => {
    const { app, sink } = setup()
    const body = gzipSync(JSON.stringify(request([{ body: { stringValue: 'hi' } }])))
    const ok = await app.request('/v1/logs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        authorization: `Bearer ${KEY}`,
      },
      body,
    })
    expect(ok.status).toBe(200)
    expect(sink.batches).toHaveLength(1)
    const refused = await app.request('/v1/logs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request([])),
    })
    expect(refused.status).toBe(401)
  })

  it('answers traces and metrics with a warning and keeps nothing', async () => {
    const { app, sink } = setup()
    const res = await app.request('/v1/traces', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-octadash-key': KEY },
      body: '{}',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ partialSuccess: { rejectedSpans: '0' } })
    expect(sink.batches).toHaveLength(0)
  })

  it('refuses a body that is not OTLP', async () => {
    const res = await setup().app.request('/v1/logs', {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf', 'x-octadash-key': KEY },
      body: new Uint8Array([0x0a, 0xff, 0x01]),
    })
    expect(res.status).toBe(400)
  })
})
