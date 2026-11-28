import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Addresses an uptime check must never reach: loopback, private networks,
 * link-local (cloud metadata lives at 169.254.169.254) and similar. Without
 * this, anyone who can add a product could make the worker read internal
 * services.
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  const lower = ip.toLowerCase()
  return (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb') ||
    lower.startsWith('ff')
  )
}

export class BlockedAddressError extends Error {
  override name = 'BlockedAddressError'
}

/**
 * Throws when the URL is not http(s) or its host resolves to a private address.
 * Returns the first address the host resolves to, so a check can say which
 * server answered (two products down on the same address point to one server).
 */
export async function assertPublicUrl(url: URL, allowPrivate: boolean): Promise<string | null> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedAddressError(`unsupported protocol ${url.protocol}`)
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (allowPrivate) {
    if (isIP(host)) return host
    return lookup(host, { verbatim: true }).then(
      (entry) => entry.address,
      () => null,
    )
  }
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address)
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new BlockedAddressError(`${host} resolves to a private address`)
  }
  return addresses[0] ?? null
}

/** Reads a response body as text, stopping at `limit` bytes. */
export async function readLimited(response: Response, limit: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < limit) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
  }
  await reader.cancel().catch(() => {})
  const buffer = new Uint8Array(Math.min(size, limit))
  let offset = 0
  for (const chunk of chunks) {
    const part = chunk.subarray(0, buffer.byteLength - offset)
    buffer.set(part, offset)
    offset += part.byteLength
    if (offset >= buffer.byteLength) break
  }
  return new TextDecoder().decode(buffer)
}
