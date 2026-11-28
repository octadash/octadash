import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { inspectTls, type TlsInfo, USER_AGENT } from './check'

/**
 * What Octadash checked when a monitor went down, to tell a problem on the
 * product's side from one on Octadash's own: where the name points, the
 * certificate, what the server answered, whether control addresses answer
 * from here, and whether the product lives on Octadash's own server.
 */
export interface Diagnosis {
  host: string
  /** Where the host name resolves. Null when it does not. */
  ip: string | null
  tls: { daysLeft: number; trusted: boolean } | null
  /** The last check's answer. */
  status: number | null
  error: string | null
  /** Control addresses reached from this server, with the time they took. Null: no answer. */
  controls: { target: string; ms: number | null }[]
  /** The product resolves to an address of Octadash's own server. Null when unknown. */
  sameServer: boolean | null
}

export interface DiagnoseOptions {
  /** Addresses that should always answer (OCTADASH_UPTIME_REFERENCE_URLS). */
  controls: string[]
  /** Addresses of the server Octadash runs on. */
  ownAddresses?: () => Promise<Set<string>>
  fetch?: typeof fetch
  inspectTls?: (host: string, port: number) => Promise<TlsInfo | null>
  resolve?: (host: string) => Promise<string | null>
  now?: () => number
}

async function resolveHost(host: string): Promise<string | null> {
  if (isIP(host)) return host
  return lookup(host, { verbatim: true }).then(
    (entry) => entry.address,
    () => null,
  )
}

export async function diagnose(
  url: string,
  last: { ip: string | null; status: number | null; error: string | null },
  options: DiagnoseOptions,
): Promise<Diagnosis> {
  const doFetch = options.fetch ?? fetch
  const now = options.now ?? (() => performance.now())
  let parsed: URL | null = null
  try {
    parsed = new URL(url)
  } catch {
    // An invalid address still gets the control checks.
  }
  const host = parsed?.hostname.replace(/^\[|\]$/g, '') ?? url
  const control = async (target: string) => {
    const started = now()
    try {
      const response = await doFetch(target, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5_000),
        headers: { 'user-agent': USER_AGENT },
      })
      await response.body?.cancel().catch(() => {})
      return { target: new URL(target).hostname, ms: Math.round(now() - started) }
    } catch {
      return { target: URL.canParse(target) ? new URL(target).hostname : target, ms: null }
    }
  }
  const [ip, tls, controls, own] = await Promise.all([
    last.ip ? Promise.resolve(last.ip) : (options.resolve ?? resolveHost)(host),
    parsed?.protocol === 'https:'
      ? (options.inspectTls ?? inspectTls)(host, Number(parsed.port || 443)).catch(() => null)
      : Promise.resolve(null),
    Promise.all(options.controls.map(control)),
    options.ownAddresses?.().catch(() => null) ?? Promise.resolve(null),
  ])
  return {
    host,
    ip,
    tls: tls ? { daysLeft: tls.daysLeft, trusted: tls.trusted } : null,
    status: last.status,
    error: last.error,
    controls,
    sameServer: own && ip ? own.has(ip) : null,
  }
}
