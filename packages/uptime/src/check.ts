import { connect } from 'node:tls'
import { assertPublicUrl, readLimited } from './net'

export const USER_AGENT = 'OctadashUptime/1.0 (+https://github.com/octadash/octadash)'

const MAX_REDIRECTS = 6
const DEFAULT_TIMEOUT_MS = 15_000
/** Enough to tell a health answer from an HTML page; the rest of the body is skipped. */
const BODY_LIMIT = 4096
/** Kept from a failed check's body: enough to read the error page. */
const ANSWER_BODY_CHARS = 1024

/**
 * site: the address answers with a page (2xx or 3xx after redirects).
 * health: a health endpoint answers 2xx with something that is not HTML, so a
 * framework's "not found" page served with 200 does not count as healthy.
 */
export type CheckKind = 'site' | 'health'

export interface TlsInfo {
  validTo: string
  daysLeft: number
  issuer: string | null
  /** The certificate chain is valid for the host name. */
  trusted: boolean
}

/** What one uptime check learned. Only facts read from the response, nothing guessed. */
export interface CheckResult {
  url: string
  up: boolean
  /** Final status code after redirects, or null when nothing answered. */
  status: number | null
  /** Time until the final response headers arrived, redirects included. */
  durationMs: number | null
  /** Why the check failed: a network code (ENOTFOUND, ECONNREFUSED), "timeout", "HTTP 503". */
  error: string | null
  /** The address the monitored host resolved to, before any redirect. Null when it did not resolve. */
  ip: string | null
  finalUrl: string | null
  redirects: string[]
  /** Plain http on the final host sends people to https. Null when it could not be checked. */
  httpsRedirect: boolean | null
  tls: TlsInfo | null
  /**
   * What the server answered when the check failed: its headers (cookies
   * left out) and the start of the body. Null when it was up or did not answer.
   */
  answer: { headers: Record<string, string>; body: string } | null
}

export interface CheckOptions {
  kind?: CheckKind
  timeoutMs?: number
  /** Let the worker reach private addresses. Only for local development. */
  allowPrivate?: boolean
  /** Also check the http to https redirect and the certificate (the slower parts). */
  deep?: boolean
  fetch?: typeof fetch
  inspectTls?: (host: string, port: number) => Promise<TlsInfo | null>
  now?: () => number
}

type Fetch = typeof fetch

async function request(
  doFetch: Fetch,
  url: URL,
  allowPrivate: boolean,
  timeoutMs: number,
  onAddress?: (ip: string | null) => void,
): Promise<Response> {
  const ip = await assertPublicUrl(url, allowPrivate)
  onAddress?.(ip)
  return doFetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': USER_AGENT, accept: '*/*' },
  })
}

/** Follows redirects by hand so each hop goes through the address check. */
async function follow(
  doFetch: Fetch,
  start: URL,
  allowPrivate: boolean,
  timeoutMs: number,
  onAddress: (ip: string | null) => void,
): Promise<{ response: Response; url: URL; redirects: string[] }> {
  let url = start
  const redirects: string[] = []
  for (let hop = 0; ; hop++) {
    const response = await request(
      doFetch,
      url,
      allowPrivate,
      timeoutMs,
      hop === 0 ? onAddress : undefined,
    )
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

/** Decides if a final response means "up" for this kind of monitor. */
export function isUp(kind: CheckKind, status: number, contentType: string, body: string): boolean {
  if (kind === 'health') {
    return status >= 200 && status < 300 && !contentType.includes('html') && !/^\s*</.test(body)
  }
  return status >= 200 && status < 400
}

/**
 * Checks one address the way a visitor would reach it. Never reads more than a
 * few KB of the body, so checking a heavy page stays cheap.
 */
export async function checkUrl(input: string, options: CheckOptions = {}): Promise<CheckResult> {
  const doFetch = options.fetch ?? fetch
  const kind = options.kind ?? 'site'
  const allowPrivate = options.allowPrivate ?? false
  const now = options.now ?? (() => performance.now())
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const empty: CheckResult = {
    url: input,
    up: false,
    status: null,
    durationMs: null,
    error: null,
    ip: null,
    finalUrl: null,
    redirects: [],
    httpsRedirect: null,
    tls: null,
    answer: null,
  }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { ...empty, error: 'invalid url' }
  }

  const started = now()
  let ip: string | null = null
  let page: Awaited<ReturnType<typeof follow>>
  try {
    page = await follow(doFetch, url, allowPrivate, timeoutMs, (address) => {
      ip = address
    })
  } catch (error) {
    return { ...empty, ip, durationMs: Math.round(now() - started), error: describeError(error) }
  }
  const durationMs = Math.round(now() - started)
  const { status } = page.response
  const contentType = page.response.headers.get('content-type') ?? ''
  const body = await readLimited(page.response, BODY_LIMIT).catch(() => '')
  const up = isUp(kind, status, contentType, body)
  const https = page.url.protocol === 'https:'

  const [httpsRedirect, tls] = options.deep
    ? await Promise.all([
        https ? checkHttpsRedirect(doFetch, page.url.host, allowPrivate) : Promise.resolve(false),
        https
          ? (options.inspectTls ?? inspectTls)(page.url.hostname, Number(page.url.port || 443))
          : Promise.resolve(null),
      ])
    : [null, null]

  return {
    ...empty,
    up,
    status,
    durationMs,
    error: up ? null : kind === 'health' && status < 300 ? 'not a health answer' : `HTTP ${status}`,
    ip,
    finalUrl: page.url.href,
    redirects: page.redirects,
    httpsRedirect,
    tls,
    answer: up ? null : answerOf(page.response.headers, body),
  }
}

/** The answer of a failed check, small: no cookies, the first KB of the body. */
function answerOf(headers: Headers, body: string) {
  const out: Record<string, string> = {}
  let n = 0
  headers.forEach((value, name) => {
    if (n++ >= 40 || /^(set-)?cookie$/i.test(name)) return
    out[name] = value.slice(0, 500)
  })
  return { headers: out, body: body.slice(0, ANSWER_BODY_CHARS) }
}
