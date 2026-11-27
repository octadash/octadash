import { describe, expect, it } from 'vitest'
import { collectSnapshot, extractUrls, isFirstParty, normalizeUrl } from './collect'
import { isPrivateAddress } from './net'

describe('normalizeUrl', () => {
  it('adds https when the scheme is missing', () => {
    expect(normalizeUrl('postato.com.br').href).toBe('https://postato.com.br/')
    expect(normalizeUrl(' http://a.dev/x ').href).toBe('http://a.dev/x')
  })
})

describe('extractUrls', () => {
  const base = new URL('https://www.example.com/pricing')
  it('splits scripts from links and resolves relative URLs', () => {
    const html = `
      <script src="/_next/static/chunks/main-abc.js" async></script>
      <script>window.x = 1</script>
      <link rel="modulepreload" href="/assets/index-123.js">
      <link rel="stylesheet" href="/app.css">
      <a href="https://buy.stripe.com/abc?x=1&amp;y=2">Buy</a>
      <a href="#top">Top</a>
      <a href="mailto:hi@example.com">Mail</a>
      <iframe src='https://www.youtube.com/embed/xyz'></iframe>
      <form action=/subscribe method=post></form>
      <script>self.__next_f.push([1,"0:[\\"/_next/static/chunks/lazy-9.js\\"]"])</script>`
    expect(extractUrls(html, base)).toEqual({
      scripts: [
        'https://www.example.com/_next/static/chunks/main-abc.js',
        'https://www.example.com/assets/index-123.js',
        'https://www.example.com/_next/static/chunks/lazy-9.js',
      ],
      links: [
        'https://buy.stripe.com/abc?x=1&y=2',
        'https://www.youtube.com/embed/xyz',
        'https://www.example.com/subscribe',
      ],
    })
  })
})

describe('isFirstParty', () => {
  const page = new URL('https://www.example.com/')
  it('accepts the same site and its subdomains', () => {
    expect(isFirstParty('https://www.example.com/a.js', page)).toBe(true)
    expect(isFirstParty('https://cdn.example.com/a.js', page)).toBe(true)
    expect(isFirstParty('https://example.com.evil.dev/a.js', page)).toBe(false)
    expect(isFirstParty('https://js.stripe.com/v3/', page)).toBe(false)
  })
})

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

/** A fake web: each URL answers with a fixed response. */
function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    const route = routes[url]
    if (!route) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    return route()
  }) as typeof fetch
}

describe('collectSnapshot', () => {
  it('follows redirects, reads scripts and probes health', async () => {
    const snapshot = await collectSnapshot('example.com', {
      allowPrivate: true,
      inspectTls: async () => ({
        validTo: '2027-03-01T00:00:00.000Z',
        daysLeft: 90,
        issuer: "Let's Encrypt",
        trusted: true,
      }),
      fetch: fakeFetch({
        'https://example.com/': () =>
          new Response(null, { status: 301, headers: { location: 'https://www.example.com/' } }),
        'https://www.example.com/': () =>
          new Response(
            '<html><script src="/app.js"></script><script src="https://js.stripe.com/v3/"></script></html>',
            { headers: { 'content-type': 'text/html' } },
          ),
        'https://www.example.com/app.js': () => new Response('Sentry.init({dsn:"x"});__SENTRY__'),
        'http://www.example.com/': () =>
          new Response(null, { status: 301, headers: { location: 'https://www.example.com/' } }),
        'https://www.example.com/api/health': () =>
          new Response('<!doctype html><p>not found page</p>', {
            headers: { 'content-type': 'text/html' },
          }),
        'https://www.example.com/health': () =>
          new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }),
      }),
    })
    expect(snapshot).toMatchObject({
      finalUrl: 'https://www.example.com/',
      reachable: true,
      httpStatus: 200,
      redirects: ['https://www.example.com/'],
      scriptUrls: ['https://www.example.com/app.js', 'https://js.stripe.com/v3/'],
      bundles: ['Sentry.init({dsn:"x"});__SENTRY__'],
      httpsRedirect: true,
      health: { path: '/health', status: 200 },
      tls: { trusted: true, daysLeft: 90 },
    })
  })

  it('reports why a site could not be reached', async () => {
    const snapshot = await collectSnapshot('https://down.example/', {
      allowPrivate: true,
      fetch: fakeFetch({}),
    })
    expect(snapshot).toMatchObject({ reachable: false, error: 'ENOTFOUND', finalUrl: null })
  })

  it('refuses private addresses unless allowed', async () => {
    const snapshot = await collectSnapshot('http://127.0.0.1:5432/', { fetch: fakeFetch({}) })
    expect(snapshot.reachable).toBe(false)
    expect(snapshot.error).toMatch(/private address/)
  })

  it('stops after too many redirects', async () => {
    const loop = () => new Response(null, { status: 302, headers: { location: '/' } })
    const snapshot = await collectSnapshot('https://loop.example/', {
      allowPrivate: true,
      fetch: fakeFetch({ 'https://loop.example/': loop }),
    })
    expect(snapshot.error).toBe('too many redirects')
  })
})
