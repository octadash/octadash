/**
 * What the ingest learns from the request itself, before the data is queued:
 * browser, system and device from the user agent, the country from a proxy
 * header, and whether it is a bot. The IP address is never stored; it only
 * feeds the daily visitor hash.
 */

export interface RequestContext {
  ip: string
  userAgent: string
  /** Two letters, upper case, or '' when no proxy says it. */
  country: string
}

export interface Client {
  browser: string
  os: string
  device: 'desktop' | 'mobile' | 'tablet' | ''
  isBot: boolean
}

const BOT =
  /bot\b|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|whatsapp|telegrambot|discordbot|headlesschrome|lighthouse|pingdom|uptimerobot|python-requests|curl\/|wget\/|go-http-client|node-fetch|axios\/|httpclient|okhttp|java\/|gptbot|chatgpt-user|claudebot|perplexitybot|ccbot|bytespider|petalbot|ahrefsbot|semrushbot|yandex/i

const BROWSERS: [RegExp, string][] = [
  [/edg(e|a|ios)?\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/samsungbrowser\//i, 'Samsung Internet'],
  [/yabrowser\//i, 'Yandex'],
  [/firefox\/|fxios\//i, 'Firefox'],
  [/crios\/|chrome\/|chromium\//i, 'Chrome'],
  [/version\/[\d.]+.*safari\//i, 'Safari'],
]

const SYSTEMS: [RegExp, string][] = [
  [/windows nt/i, 'Windows'],
  [/iphone|ipad|ipod/i, 'iOS'],
  [/android/i, 'Android'],
  [/cros/i, 'ChromeOS'],
  [/mac os x|macintosh/i, 'macOS'],
  [/linux/i, 'Linux'],
]

export function parseUserAgent(ua: string): Client {
  if (!ua) return { browser: '', os: '', device: '', isBot: false }
  const isBot = BOT.test(ua)
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1] ?? ''
  const os = SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? ''
  let device: Client['device'] = 'desktop'
  if (/ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) device = 'tablet'
  else if (/mobi|iphone|ipod/i.test(ua)) device = 'mobile'
  return { browser, os, device, isBot }
}

/** Headers proxies and CDNs set with the visitor's country. */
const COUNTRY_HEADERS = [
  'cf-ipcountry',
  'cloudfront-viewer-country',
  'x-vercel-ip-country',
  'x-country-code',
]

export function requestContext(header: (name: string) => string | undefined): RequestContext {
  // The first address of X-Forwarded-For is the client; Coolify's Traefik and most proxies set it.
  const forwarded = header('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = forwarded || header('x-real-ip')?.trim() || ''
  let country = ''
  for (const name of COUNTRY_HEADERS) {
    const value = header(name)?.trim().toUpperCase()
    // Cloudflare says XX for unknown and T1 for Tor.
    if (value && /^[A-Z]{2}$/.test(value) && value !== 'XX' && value !== 'T1') {
      country = value
      break
    }
  }
  return { ip, userAgent: header('user-agent') ?? '', country }
}

export interface PageFields {
  path: string
  host: string
  referrer_host: string
  utm_source: string
  utm_medium: string
  utm_campaign: string
}

const EMPTY_PAGE: PageFields = {
  path: '',
  host: '',
  referrer_host: '',
  utm_source: '',
  utm_medium: '',
  utm_campaign: '',
}

function parseUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function bareHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '')
}

/**
 * The page and where the visit came from, read from `$current_url` and
 * `$referrer` (the names PostHog uses, so its web SDK fills them too). A
 * referrer on the same site is not a source of traffic.
 */
export function pageFields(properties: Record<string, unknown> | undefined): PageFields {
  const page = parseUrl(properties?.$current_url)
  if (!page) return EMPTY_PAGE
  const host = bareHost(page)
  const referrer = parseUrl(properties?.$referrer)
  const referrerHost = referrer ? bareHost(referrer) : ''
  const utm = (name: string) => (page.searchParams.get(name) ?? '').trim().slice(0, 200)
  return {
    path: page.pathname.slice(0, 1000) || '/',
    host,
    referrer_host: referrerHost === host ? '' : referrerHost,
    utm_source: utm('utm_source').toLowerCase(),
    utm_medium: utm('utm_medium').toLowerCase(),
    utm_campaign: utm('utm_campaign'),
  }
}
