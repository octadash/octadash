import { connect } from 'node:tls'
import { assertPublicUrl, readLimited } from './net'
import type { HealthInfo, TlsInfo } from './types'

export const USER_AGENT = 'OctadashBot/1.0 (+https://github.com/octadash/octadash)'

const MAX_REDIRECTS = 6
const PAGE_TIMEOUT_MS = 15_000
const PAGE_LIMIT = 3 * 1024 * 1024
const SCRIPT_LIMIT = 1.5 * 1024 * 1024
const SCRIPTS_TOTAL_LIMIT = 10 * 1024 * 1024
const MAX_SCRIPTS = 30
const HEALTH_PATHS = [
  '/api/health',
  '/health',
  '/healthz',
  '/api/healthz',
  '/api/status',
  '/status',
]

/** What the diagnosis could read from outside the site. Detection runs on this. */
export interface Snapshot {
  url: string
  finalUrl: string | null
  reachable: boolean
  httpStatus: number | null
  durationMs: number | null
  error: string | null
  redirects: string[]
  html: string
  /** Every external script the page loads, by absolute URL. */
  scriptUrls: string[]
  /** Links, iframes and form targets: checkout and store links show up here. */
  linkUrls: string[]
  /** Bodies of first-party scripts, where bundled SDKs (Sentry, PostHog) live. */
  bundles: string[]
  httpsRedirect: boolean | null
  tls: TlsInfo | null
  health: HealthInfo | null
}

export interface CollectOptions {
  /** Let the worker reach private addresses. Only for local development. */
  allowPrivate?: boolean
  fetch?: typeof fetch
  inspectTls?: (host: string, port: number) => Promise<TlsInfo | null>
  now?: () => number
}

/** Accepts "example.com" and "https://example.com/path"; returns an absolute URL. */
export function normalizeUrl(input: string): URL {
  const trimmed = input.trim()
  return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
}

type Fetch = typeof fetch

async function request(
  doFetch: Fetch,
  url: URL,
  allowPrivate: boolean,
  timeoutMs: number,
): Promise<Response> {
  await assertPublicUrl(url, allowPrivate)
  return doFetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*;q=0.8' },
  })
}

/** Follows redirects by hand so each hop goes through the address check. */
async function follow(
  doFetch: Fetch,
  start: URL,
  allowPrivate: boolean,
  timeoutMs: number,
): Promise<{ response: Response; url: URL; redirects: string[] }> {
  let url = start
  const redirects: string[] = []
  for (let hop = 0; ; hop++) {
    const response = await request(doFetch, url, allowPrivate, timeoutMs)
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) {
      return { response, url, redirects }
    }
    await response.body?.cancel().catch(() => {})
    if (hop >= MAX_REDIRECTS) throw new Error('too many redirects')
    url = new URL(location, url)
    redirects.push(url.href)
  }
}

const ATTRIBUTE = /\s(src|href|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
const TAG = /<(script|a|link|iframe|form)\b([^>]*)>/gi

/** Pulls script, link, iframe and form URLs out of the HTML, resolved against the page. */
export function extractUrls(html: string, base: URL): { scripts: string[]; links: string[] } {
  const scripts = new Set<string>()
  const links = new Set<string>()
  for (const tag of html.matchAll(TAG)) {
    const name = tag[1]?.toLowerCase()
    for (const attribute of (tag[2] ?? '').matchAll(ATTRIBUTE)) {
      const raw = attribute[2] ?? attribute[3] ?? attribute[4] ?? ''
      if (!raw || raw.startsWith('#') || /^(?:javascript|mailto|tel|data):/i.test(raw)) continue
      let resolved: string
      try {
        resolved = new URL(raw.replaceAll('&amp;', '&'), base).href
      } catch {
        continue
      }
      const isScript =
        name === 'script' ||
        (name === 'link' && /\brel\s*=\s*["']?(?:modulepreload|preload)/i.test(tag[2] ?? ''))
      if (isScript && /\.m?js(?:[?#]|$)/i.test(resolved)) scripts.add(resolved)
      else if (name === 'script') scripts.add(resolved)
      else if (name !== 'link') links.add(resolved)
    }
  }
  return { scripts: [...scripts], links: [...links] }
}

/** Same site: the same host, or a subdomain of the page's host without "www.". */
export function isFirstParty(scriptUrl: string, page: URL): boolean {
  const host = new URL(scriptUrl).hostname
  const site = page.hostname.replace(/^www\./, '')
  return host === page.hostname || host === site || host.endsWith(`.${site}`)
}

async function fetchBundles(
  doFetch: Fetch,
  urls: string[],
  allowPrivate: boolean,
): Promise<string[]> {
  const bundles: string[] = []
  let total = 0
  const queue = urls.slice(0, MAX_SCRIPTS)
  while (queue.length > 0 && total < SCRIPTS_TOTAL_LIMIT) {
    const batch = queue.splice(0, 5)
    const bodies = await Promise.all(
      batch.map(async (url) => {
        try {
          const { response } = await follow(doFetch, new URL(url), allowPrivate, 10_000)
          if (!response.ok) return ''
          return await readLimited(response, SCRIPT_LIMIT)
        } catch {
          return ''
        }
      }),
    )
    for (const body of bodies) {
      if (!body) continue
      bundles.push(body)
      total += body.length
    }
  }
  return bundles
}

/** Does plain http on this host send people to https? */
async function checkHttpsRedirect(
  doFetch: Fetch,
  host: string,
  allowPrivate: boolean,
): Promise<boolean | null> {
  try {
    const response = await request(doFetch, new URL(`http://${host}/`), allowPrivate, 8_000)
    await response.body?.cancel().catch(() => {})
    const location = response.headers.get('location')
    return response.status >= 300 && response.status < 400 && !!location?.startsWith('https://')
  } catch {
    return null
  }
}

/** A health endpoint answers 2xx with something that is not the site's HTML. */
async function probeHealth(
  doFetch: Fetch,
  origin: URL,
  allowPrivate: boolean,
  now: () => number,
): Promise<HealthInfo | null> {
  for (const path of HEALTH_PATHS) {
    const url = new URL(path, origin)
    const started = now()
    try {
      const response = await request(doFetch, url, allowPrivate, 5_000)
      const type = response.headers.get('content-type') ?? ''
      const body = await readLimited(response, 4096)
      if (response.ok && !type.includes('html') && !/^\s*</.test(body)) {
        return { path, status: response.status, durationMs: Math.round(now() - started) }
      }
    } catch {
      // try the next path
    }
  }
  return null
}

/** Reads the certificate the server presents, without failing on a bad one. */
export function inspectTls(host: string, port = 443): Promise<TlsInfo | null> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, servername: host, rejectUnauthorized: false })
    const done = (value: TlsInfo | null) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(8_000, () => done(null))
    socket.once('error', () => done(null))
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate()
      if (!cert?.valid_to) return done(null)
      const validTo = new Date(cert.valid_to)
      const issuer = cert.issuer?.O ?? cert.issuer?.CN ?? null
      done({
        validTo: validTo.toISOString(),
        daysLeft: Math.floor((validTo.getTime() - Date.now()) / 86_400_000),
        issuer: Array.isArray(issuer) ? (issuer[0] ?? null) : issuer,
        trusted: socket.authorized,
      })
    })
  })
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  if (error.name === 'TimeoutError') return 'timeout'
  const { code, cause } = error as Error & { code?: string; cause?: { code?: string } }
  return cause?.code ?? code ?? error.message
}

/** Visits the site once, like a first-time visitor, and keeps what detection needs. */
export async function collectSnapshot(
  input: string,
  options: CollectOptions = {},
): Promise<Snapshot> {
  const doFetch = options.fetch ?? fetch
  const allowPrivate = options.allowPrivate ?? false
  const now = options.now ?? (() => performance.now())
  const url = normalizeUrl(input)
  const empty: Snapshot = {
    url: url.href,
    finalUrl: null,
    reachable: false,
    httpStatus: null,
    durationMs: null,
    error: null,
    redirects: [],
    html: '',
    scriptUrls: [],
    linkUrls: [],
    bundles: [],
    httpsRedirect: null,
    tls: null,
    health: null,
  }

  const started = now()
  let page: Awaited<ReturnType<typeof follow>>
  try {
    page = await follow(doFetch, url, allowPrivate, PAGE_TIMEOUT_MS)
  } catch (error) {
    return { ...empty, error: describeError(error) }
  }
  const html = await readLimited(page.response, PAGE_LIMIT).catch(() => '')
  const durationMs = Math.round(now() - started)
  const { status } = page.response
  const reachable = status < 500
  const { scripts, links } = extractUrls(html, page.url)
  const firstParty = scripts.filter((script) => isFirstParty(script, page.url))
  const https = page.url.protocol === 'https:'

  const [bundles, httpsRedirect, tls, health] = await Promise.all([
    fetchBundles(doFetch, firstParty, allowPrivate),
    https ? checkHttpsRedirect(doFetch, page.url.host, allowPrivate) : Promise.resolve(false),
    https
      ? (options.inspectTls ?? inspectTls)(page.url.hostname, Number(page.url.port || 443))
      : Promise.resolve(null),
    reachable ? probeHealth(doFetch, page.url, allowPrivate, now) : Promise.resolve(null),
  ])

  return {
    ...empty,
    finalUrl: page.url.href,
    reachable,
    httpStatus: status,
    durationMs,
    error: reachable ? null : `HTTP ${status}`,
    redirects: page.redirects,
    html,
    scriptUrls: scripts,
    linkUrls: links,
    bundles,
    httpsRedirect,
    tls,
    health,
  }
}
