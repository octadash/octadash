import { MemorySink } from '@octadash/queue'
import { describe, expect, it } from 'vitest'
import { createApp, MAX_BODY_BYTES } from './app'
import { staticResolver } from './keys'

const KEY = 'a'.repeat(32)
const scope = {
  org_id: '00000000-0000-4000-8000-00000000000a',
  project_id: '00000000-0000-4000-8000-0000000000b1',
}

function setup() {
  const sink = new MemorySink()
  const app = createApp({ sink, keys: staticResolver({ [KEY]: scope }) })
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    app.request('/o/v1/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  return { app, sink, post }
}

describe('ingest app', () => {
  it('answers the health check without a database', async () => {
    const res = await setup().app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'ingest' })
  })

  it('allows cross-origin calls from SDKs', async () => {
    const res = await setup().app.request('/health', {
      headers: { origin: 'https://postato.com.br' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
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
            timestamp: '2026-11-27T10:00:00.000Z',
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
      ...scope,
      event: 'pageview',
      timestamp: '2026-11-27 10:00:00.000',
      distinct_id: 'u1',
      session_id: '',
      properties: '{"path":"/"}',
    })
    expect(sink.batches[0]?.rows[1]).toMatchObject({ event: 'signup.completed', properties: '{}' })
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
