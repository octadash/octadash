import { describe, expect, it } from 'vitest'
import { checkUrl, isUp } from './check'
import { isPrivateAddress } from './net'

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])('blocks %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true)
  })

  it.each(['8.8.8.8', '172.32.0.1', '151.101.1.69', '2606:4700::6810:84e5'])('allows %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false)
  })
})

describe('isUp', () => {
  it('accepts any page for a site and only a non-HTML 2xx for a health endpoint', () => {
    expect(isUp('site', 200, 'text/html', '<html>')).toBe(true)
    expect(isUp('site', 404, 'text/html', '<html>')).toBe(false)
    expect(isUp('site', 503, 'text/plain', 'down')).toBe(false)
    expect(isUp('health', 200, 'application/json', '{"ok":true}')).toBe(true)
    expect(isUp('health', 200, 'text/plain', 'ok')).toBe(true)
    expect(isUp('health', 200, 'text/html', '<!doctype html>')).toBe(false)
    expect(isUp('health', 200, '', '  <html>')).toBe(false)
    expect(isUp('health', 302, 'application/json', '{}')).toBe(false)
  })
})

/** A fake web: each URL answers with a fixed response. */
function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    const route = routes[url]
    if (!route) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    return route()
  }) as typeof fetch
}

const tls = {
  validTo: '2027-03-01T00:00:00.000Z',
  daysLeft: 90,
  issuer: "Let's Encrypt",
  trusted: true,
}

describe('checkUrl', () => {
  it('follows redirects and, when deep, checks the https redirect and the certificate', async () => {
    const result = await checkUrl('https://example.com/', {
      allowPrivate: true,
      deep: true,
      inspectTls: async () => tls,
      fetch: fakeFetch({
        'https://example.com/': () =>
          new Response(null, { status: 301, headers: { location: 'https://www.example.com/' } }),
        'https://www.example.com/': () =>
          new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
        'http://www.example.com/': () =>
          new Response(null, { status: 301, headers: { location: 'https://www.example.com/' } }),
      }),
    })
    expect(result).toMatchObject({
      up: true,
      status: 200,
      error: null,
      finalUrl: 'https://www.example.com/',
      redirects: ['https://www.example.com/'],
      httpsRedirect: true,
      tls: { trusted: true, daysLeft: 90 },
    })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('says which address the host resolved to, even when it fails', async () => {
    const up = await checkUrl('http://203.0.113.7/', {
      allowPrivate: true,
      fetch: fakeFetch({ 'http://203.0.113.7/': () => new Response('ok') }),
    })
    expect(up.ip).toBe('203.0.113.7')
    const down = await checkUrl('http://203.0.113.8/', {
      allowPrivate: true,
      fetch: fakeFetch({ 'http://203.0.113.8/': () => new Response('bad', { status: 502 }) }),
    })
    expect(down).toMatchObject({ up: false, ip: '203.0.113.8', error: 'HTTP 502' })
  })

  it('skips the slow parts unless asked', async () => {
    const result = await checkUrl('https://example.com/', {
      allowPrivate: true,
      inspectTls: async () => tls,
      fetch: fakeFetch({ 'https://example.com/': () => new Response('ok') }),
    })
    expect(result).toMatchObject({ up: true, httpsRedirect: null, tls: null })
  })

  it('marks a health endpoint that answers with an HTML page as down', async () => {
    const result = await checkUrl('https://example.com/health', {
      kind: 'health',
      allowPrivate: true,
      fetch: fakeFetch({
        'https://example.com/health': () =>
          new Response('<!doctype html><p>not found</p>', {
            headers: { 'content-type': 'text/html' },
          }),
      }),
    })
    expect(result).toMatchObject({ up: false, status: 200, error: 'not a health answer' })
  })

  it('reports the status code when the server answers with an error', async () => {
    const result = await checkUrl('https://example.com/', {
      allowPrivate: true,
      fetch: fakeFetch({ 'https://example.com/': () => new Response('', { status: 502 }) }),
    })
    expect(result).toMatchObject({ up: false, status: 502, error: 'HTTP 502' })
  })

  it('keeps what the server answered when a check fails, without cookies', async () => {
    const result = await checkUrl('https://example.com/', {
      allowPrivate: true,
      fetch: fakeFetch({
        'https://example.com/': () =>
          new Response('upstream timed out'.padEnd(3000, '.'), {
            status: 504,
            headers: { server: 'nginx', 'set-cookie': 'sid=secret' },
          }),
      }),
    })
    expect(result.answer?.headers).toMatchObject({ server: 'nginx' })
    expect(result.answer?.headers).not.toHaveProperty('set-cookie')
    expect(result.answer?.body.startsWith('upstream timed out')).toBe(true)
    expect(result.answer?.body).toHaveLength(1024)
  })

  it('reports why a site could not be reached', async () => {
    const result = await checkUrl('https://down.example/', {
      allowPrivate: true,
      fetch: fakeFetch({}),
    })
    expect(result).toMatchObject({ up: false, error: 'ENOTFOUND', status: null })
  })

  it('refuses private addresses unless allowed', async () => {
    const result = await checkUrl('http://127.0.0.1:5432/', { fetch: fakeFetch({}) })
    expect(result.up).toBe(false)
    expect(result.error).toMatch(/private address/)
  })

  it('stops after too many redirects', async () => {
    const loop = () => new Response(null, { status: 302, headers: { location: '/' } })
    const result = await checkUrl('https://loop.example/', {
      allowPrivate: true,
      fetch: fakeFetch({ 'https://loop.example/': loop }),
    })
    expect(result.error).toBe('too many redirects')
  })
})
