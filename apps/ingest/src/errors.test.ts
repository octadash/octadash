import { gzipSync } from 'node:zlib'
import { MemoryHeartbeats, MemorySalts, MemorySink } from '@octadash/queue'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import {
  cleanFilename,
  defaultGrouping,
  normalizeMessage,
  parseEnvelope,
  sentryKey,
  toErrorRow,
} from './errors'
import type { Sender } from './events'
import { staticResolver } from './keys'

const KEY = 'a'.repeat(32)
const scope = {
  org_id: '00000000-0000-4000-8000-00000000000a',
  project_id: '00000000-0000-4000-8000-0000000000b1',
  source_id: '00000000-0000-4000-8000-0000000000c1',
  visitor_mode: 'daily' as const,
}
const browser: Sender = {
  ip: '203.0.113.9',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  country: 'BR',
  visitor: async () => 'f'.repeat(32),
}

/** What @sentry/nextjs sends for an unhandled TypeError in the browser. */
function sentryEvent(chunk = 'page-3f2a9c1b.js', line = 42) {
  return {
    event_id: '0123456789abcdef0123456789abcdef',
    timestamp: 1_795_000_000.123,
    platform: 'javascript',
    level: 'error',
    release: 'v2.14',
    environment: 'production',
    sdk: { name: 'sentry.javascript.nextjs', version: '10.5.0' },
    request: {
      url: 'https://shop.example/checkout?coupon=X',
      headers: { 'User-Agent': browser.userAgent },
    },
    exception: {
      values: [
        {
          type: 'TypeError',
          value: "Cannot read properties of undefined (reading 'price')",
          mechanism: { type: 'onerror', handled: false },
          stacktrace: {
            frames: [
              {
                filename: 'https://shop.example/_next/static/chunks/framework-aa11bb22.js',
                function: 'renderWithHooks',
                lineno: 1,
                colno: 9000,
                in_app: false,
              },
              {
                filename: `https://shop.example/_next/static/chunks/app/checkout/${chunk}`,
                abs_path: `https://shop.example/_next/static/chunks/app/checkout/${chunk}`,
                function: 'CartTotal',
                lineno: line,
                colno: 30,
                in_app: true,
              },
            ],
          },
        },
      ],
    },
    breadcrumbs: {
      values: [
        { timestamp: 1_795_000_000, category: 'ui.click', message: 'button "Apply coupon"' },
      ],
    },
    tags: { route: '/checkout' },
    contexts: { browser: { name: 'Safari', version: '18.0' } },
  }
}

describe('error events', () => {
  it('reads a Sentry browser event', async () => {
    const row = await toErrorRow(scope, sentryEvent(), browser, new Date(1_795_000_001_000))
    expect(row).toMatchObject({
      event_id: '0123456789abcdef0123456789abcdef',
      type: 'TypeError',
      value: "Cannot read properties of undefined (reading 'price')",
      handled: 0,
      level: 'error',
      platform: 'javascript',
      sdk: 'sentry.javascript.nextjs',
      release: 'v2.14',
      environment: 'production',
      culprit: 'CartTotal in /_next/static/chunks/app/checkout/page-3f2a9c1b.js',
      path: '/checkout',
      browser: 'Safari',
      os: 'macOS',
      country: 'BR',
      person: `v:${'f'.repeat(32)}`,
      timestamp: '2026-11-18 11:06:40.123',
    })
    expect(JSON.parse(row?.exception ?? '[]')[0].frames).toHaveLength(2)
    expect(JSON.parse(row?.breadcrumbs ?? '[]')[0]).toMatchObject({ category: 'ui.click' })
    expect(JSON.parse(row?.tags ?? '{}')).toEqual({ route: '/checkout' })
  })

  it('groups the same error from a new build and another line together', async () => {
    const a = await toErrorRow(scope, sentryEvent('page-3f2a9c1b.js', 42), browser)
    const b = await toErrorRow(scope, sentryEvent('page-77de01aa.js', 57), browser)
    expect(a?.fingerprint).toBe(b?.fingerprint)
    const other = sentryEvent()
    const [main] = other.exception.values
    if (main) main.type = 'RangeError'
    expect((await toErrorRow(scope, other, browser))?.fingerprint).not.toBe(a?.fingerprint)
  })

  it('groups messages without a stack by their text without numbers', () => {
    expect(defaultGrouping([], 'user 41 not found')).toEqual(
      defaultGrouping([], 'user 42 not found'),
    )
    expect(normalizeMessage('order 5f0c3a9e-1111-4222-8333-444455556666 failed at 10.0.0.1')).toBe(
      'order <id> failed at <ip>',
    )
  })

  it('takes the app fingerprint, with {{ default }} standing for the usual one', async () => {
    const custom = { ...sentryEvent(), fingerprint: ['checkout-total'] }
    const mixed = { ...sentryEvent(), fingerprint: ['{{ default }}', 'tenant-1'] }
    const plain = await toErrorRow(scope, sentryEvent(), browser)
    const a = await toErrorRow(scope, custom, browser)
    const b = await toErrorRow(scope, mixed, browser)
    expect(new Set([plain?.fingerprint, a?.fingerprint, b?.fingerprint]).size).toBe(3)
  })

  it('names the person the app sent and never the address', async () => {
    const event = { ...sentryEvent(), user: { id: 'u_77', ip_address: '{{auto}}' } }
    const row = await toErrorRow(scope, event, browser)
    expect(row?.person).toBe('u_77')
    expect(JSON.stringify(row)).not.toContain('203.0.113.9')
    const byEmail = await toErrorRow(
      scope,
      { ...sentryEvent(), user: { email: 'ana@shop.example' } },
      browser,
    )
    expect(byEmail?.person).toMatch(/^h:[0-9a-f]{32}$/)
    expect(JSON.stringify(byEmail)).not.toContain('ana@shop.example')
  })

  it('reads message events and drops empty ones', async () => {
    const row = await toErrorRow(
      scope,
      { message: { formatted: 'Payment webhook rejected' } },
      browser,
    )
    expect(row).toMatchObject({ type: '', value: 'Payment webhook rejected', level: 'error' })
    expect(await toErrorRow(scope, { level: 'error' }, browser)).toBeNull()
    expect(await toErrorRow(scope, 'nope', browser)).toBeNull()
  })

  it('cleans file names', () => {
    expect(cleanFilename('webpack://_N_E/./app/checkout/page.tsx')).toBe('app/checkout/page.tsx')
    expect(cleanFilename('app:///dist/server.js')).toBe('/dist/server.js')
    expect(cleanFilename('https://shop.example/a.js?v=2#x')).toBe('/a.js')
  })

  it('reads envelopes with and without item lengths', () => {
    const event = JSON.stringify({ message: 'a\nb' })
    const text = `{"dsn":"https://${KEY}@o.example/1"}\n{"type":"event","length":${Buffer.byteLength(event)}}\n${event}\n{"type":"session"}\n{"sid":"x"}\n`
    const { header, items } = parseEnvelope(new TextEncoder().encode(text))
    expect(header.dsn).toContain(KEY)
    expect(items.map((item) => item.type)).toEqual(['event', 'session'])
    expect(JSON.parse(new TextDecoder().decode(items[0]?.payload))).toEqual({ message: 'a\nb' })
  })

  it('finds the key in a DSN, a header or the query', () => {
    expect(sentryKey(undefined, `https://${KEY}@o.example/1`)).toBe(KEY)
    expect(sentryKey(`Sentry sentry_version=7, sentry_key=${KEY}, sentry_client=x`)).toBe(KEY)
    expect(sentryKey(KEY)).toBe(KEY)
    expect(sentryKey('nope', undefined)).toBeUndefined()
  })
})

function setup() {
  const sink = new MemorySink()
  const app = createApp({
    sink,
    keys: staticResolver({ [KEY]: scope }),
    heartbeats: { resolver: { resolve: async () => null }, store: new MemoryHeartbeats() },
    salts: new MemorySalts(),
    now: () => 1_795_000_000_000,
  })
  return { app, sink }
}

describe('error endpoints', () => {
  it('takes a gzipped envelope from a Sentry SDK and answers with the event id', async () => {
    const { app, sink } = setup()
    const event = JSON.stringify(sentryEvent())
    const envelope = `{"event_id":"0123456789abcdef0123456789abcdef","dsn":"https://${KEY}@ingest.example/1"}\n{"type":"event"}\n${event}\n{"type":"client_report"}\n{}\n`
    const res = await app.request('/api/1/envelope/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-sentry-envelope', 'content-encoding': 'gzip' },
      body: gzipSync(envelope),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: '0123456789abcdef0123456789abcdef' })
    expect(sink.batches.map((batch) => [batch.kind, batch.rows.length])).toEqual([
      ['errors', 1],
      ['received', 1],
    ])
  })

  it('takes the old store endpoint with the key in the auth header', async () => {
    const { app, sink } = setup()
    const res = await app.request('/api/1/store/', {
      method: 'POST',
      headers: { 'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${KEY}` },
      body: JSON.stringify(sentryEvent()),
    })
    expect(res.status).toBe(200)
    expect(sink.batches[0]?.kind).toBe('errors')
  })

  it('takes the Octadash format with the key in the body', async () => {
    const { app, sink } = setup()
    const res = await app.request('/o/v1/errors', {
      method: 'POST',
      body: JSON.stringify({ key: KEY, events: [sentryEvent(), sentryEvent()] }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ accepted: 2 })
    expect(sink.batches[0]?.rows).toHaveLength(2)
  })

  it('refuses an unknown key and broken bodies', async () => {
    const { app, sink } = setup()
    const unknown = await app.request(`/api/1/store/?sentry_key=${'b'.repeat(32)}`, {
      method: 'POST',
      body: JSON.stringify(sentryEvent()),
    })
    expect(unknown.status).toBe(401)
    const broken = await app.request(`/api/1/store/?sentry_key=${KEY}`, {
      method: 'POST',
      body: '{',
    })
    expect(broken.status).toBe(400)
    const gzip = await app.request(`/api/1/envelope/?sentry_key=${KEY}`, {
      method: 'POST',
      headers: { 'content-encoding': 'gzip' },
      body: 'not gzip',
    })
    expect(gzip.status).toBe(400)
    expect(sink.batches).toHaveLength(0)
  })
})
