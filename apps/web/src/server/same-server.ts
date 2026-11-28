import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const CACHE_MS = 60 * 60 * 1000
let own: { addresses: Set<string>; at: number } | null = null

async function resolveAll(host: string): Promise<string[]> {
  if (isIP(host)) return [host]
  const found = await lookup(host, { all: true }).catch(() => [])
  return found.map((entry) => entry.address)
}

/**
 * The addresses of the server Octadash runs on: what its public URL resolves
 * to, and the address it reaches the internet from. Cached for an hour.
 */
async function ownAddresses(publicUrl: string): Promise<Set<string>> {
  if (own && Date.now() - own.at < CACHE_MS) return own.addresses
  const addresses = new Set(await resolveAll(new URL(publicUrl).hostname))
  try {
    const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(3_000) })
    const ip = (await res.text()).trim()
    if (isIP(ip)) addresses.add(ip)
  } catch {
    // Without the egress address, the public URL is still compared.
  }
  for (const local of ['127.0.0.1', '::1']) addresses.delete(local)
  own = { addresses, at: Date.now() }
  return addresses
}

/**
 * Which of these monitored addresses point to the server Octadash runs on.
 * Behind a proxy such as Cloudflare the real server is hidden, so a match can
 * be missed; it is never claimed without one.
 */
export async function sameServerUrls(publicUrl: string, urls: string[]): Promise<Set<string>> {
  const matches = new Set<string>()
  if (urls.length === 0) return matches
  const mine = await ownAddresses(publicUrl)
  if (mine.size === 0) return matches
  await Promise.all(
    urls.map(async (url) => {
      try {
        const addresses = await resolveAll(new URL(url).hostname)
        if (addresses.some((address) => mine.has(address))) matches.add(url)
      } catch {
        // An unreadable URL is not on this server.
      }
    }),
  )
  return matches
}
