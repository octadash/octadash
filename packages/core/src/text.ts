import { randomBytes } from 'node:crypto'

/** URL-safe identifier from a display name: "Orbita de Ideias" -> "orbita-de-ideias". */
export function slugify(input: string, maxLength = 48): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')
  return slug || 'product'
}

/**
 * Public ingest key: 32 lowercase hex characters, the same shape as a Sentry DSN
 * public key, so Sentry SDKs accept DSNs that point at Octadash.
 */
export function generatePublicKey(): string {
  return randomBytes(16).toString('hex')
}

/** Normalizes what people paste as a site address: adds https:// and drops the trailing slash. */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}
