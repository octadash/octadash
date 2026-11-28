import { createHash } from 'node:crypto'
import { uuidv7 } from '@octadash/core'
import {
  type ErrorBreadcrumb,
  type ErrorException,
  type ErrorFrame,
  NO_SOURCE,
  type QueuedError,
  toClickHouseTime,
} from '@octadash/db'
import { parseUserAgent } from './context'
import type { Sender } from './events'
import type { IngestScope } from './keys'
import { personal, personId } from './privacy'
import { maskDeep } from './received'

/**
 * Error events in the format of the Sentry SDKs (the JSON inside an envelope
 * item of type `event`, or the body of the old `/store/` endpoint). The
 * Octadash browser script sends the same shape to `/o/v1/errors`, so one
 * reader serves every SDK. Everything is checked by hand: an SDK sends far
 * more than is kept, and a field of the wrong type is dropped, not refused.
 */

const MAX_FRAMES = 50
const MAX_EXCEPTIONS = 5
const MAX_BREADCRUMBS = 50
const MAX_TAGS = 50
const MAX_FUTURE_MS = 60 * 60 * 1000

type Json = Record<string, unknown>

function obj(value: unknown): Json | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : undefined
}

function str(value: unknown, max = 1000): string {
  if (typeof value === 'string') return value.slice(0, max)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).slice(0, max)
  return ''
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Sentry sends lists either bare or as `{values: [...]}`. */
function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const values = obj(value)?.values
  return Array.isArray(values) ? values : []
}

/**
 * A file as people read it: no protocol, host or query, no bundler prefix.
 * "https://shop.example/_next/static/chunks/app/page-3f2a.js?v=1" becomes
 * "/_next/static/chunks/app/page-3f2a.js"; "webpack://_N_E/./app/page.tsx"
 * becomes "app/page.tsx".
 */
export function cleanFilename(name: string): string {
  let file = name.trim()
  file = file.replace(/^webpack:\/\/[^/]*\//, '').replace(/^app:\/\/\/?/, '/')
  file = file.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')
  file = file.replace(/[?#].*$/, '')
  file = file.replace(/^\.\//, '').replace(/^~\//, '')
  return file
}

/** Code that is not the app's own: packages, the runtime, the browser. */
const NOT_APP =
  /node_modules|^node:|^internal\/|\/vendor\/|^<anonymous>$|^\[native code\]$|site-packages|dist-packages|^\/usr\/lib\//

function frameOf(value: unknown): ErrorFrame | null {
  const frame = obj(value)
  if (!frame) return null
  const filename = cleanFilename(str(frame.filename, 500) || str(frame.abs_path, 500))
  const module = str(frame.module, 300)
  // SDKs write "?" or "<anonymous>" for a function without a name, alone or
  // after its object ("Object.?").
  const fn = str(frame.function, 300)
    .replace(/\.(\?|<anonymous>)$/, '')
    .replace(/^(\?|<anonymous>)$/, '')
  if (!filename && !module && !fn) return null
  const lines = (v: unknown) =>
    Array.isArray(v) ? v.slice(-5).map((line) => str(line, 300)) : undefined
  const inApp =
    typeof frame.in_app === 'boolean'
      ? frame.in_app
      : Boolean(filename || module) && !NOT_APP.test(filename || module)
  const out: ErrorFrame = { filename, function: fn, in_app: inApp }
  if (module) out.module = module
  const lineno = num(frame.lineno)
  const colno = num(frame.colno)
  if (lineno !== undefined) out.lineno = lineno
  if (colno !== undefined) out.colno = colno
  if (typeof frame.context_line === 'string') {
    out.context_line = str(frame.context_line, 300)
    out.pre_context = lines(frame.pre_context)
    out.post_context = lines(frame.post_context)
  }
  return out
}

function exceptionsOf(event: Json): ErrorException[] {
  return list(event.exception)
    .slice(-MAX_EXCEPTIONS)
    .map((value) => {
      const exception = obj(value) ?? {}
      const mechanism = obj(exception.mechanism)
      const frames = list(
        obj(exception.stacktrace)?.frames ?? obj(exception.raw_stacktrace)?.frames,
      )
        .map(frameOf)
        .filter((frame): frame is ErrorFrame => frame !== null)
        .slice(-MAX_FRAMES)
      const out: ErrorException = {
        type: str(exception.type, 200),
        value: str(exception.value, 8000),
        frames,
      }
      if (mechanism) {
        out.mechanism = {
          type: str(mechanism.type, 100) || undefined,
          handled: typeof mechanism.handled === 'boolean' ? mechanism.handled : undefined,
        }
      }
      return out
    })
    .filter((exception) => exception.type || exception.value || exception.frames.length > 0)
}

function messageOf(event: Json): string {
  const logentry = obj(event.logentry) ?? obj(event.message)
  if (logentry) return str(logentry.formatted, 8000) || str(logentry.message, 8000)
  return str(event.message, 8000)
}

function breadcrumbsOf(event: Json): ErrorBreadcrumb[] {
  return list(event.breadcrumbs)
    .slice(-MAX_BREADCRUMBS)
    .map((value) => {
      const crumb = obj(value) ?? {}
      const out: ErrorBreadcrumb = {
        timestamp: timeOf(crumb.timestamp)?.getTime() ?? 0,
        category: str(crumb.category, 100),
        type: str(crumb.type, 50) || 'default',
        level: str(crumb.level, 20) || 'info',
        message: str(crumb.message, 500),
      }
      const data = obj(crumb.data)
      if (data) {
        const text = JSON.stringify(data)
        if (text.length <= 1000) out.data = data
      }
      return out
    })
}

function tagsOf(event: Json): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = event.tags
  const pairs: [unknown, unknown][] = Array.isArray(raw)
    ? raw.filter((pair): pair is [unknown, unknown] => Array.isArray(pair) && pair.length === 2)
    : Object.entries(obj(raw) ?? {})
  for (const [key, value] of pairs.slice(0, MAX_TAGS)) {
    const name = str(key, 100)
    if (name) out[name] = str(value, 200)
  }
  return out
}

function timeOf(value: unknown): Date | undefined {
  // Sentry sends seconds since 1970, with a fraction, or an ISO date.
  const date =
    typeof value === 'number'
      ? new Date(value * 1000)
      : typeof value === 'string'
        ? new Date(value)
        : undefined
  return date && !Number.isNaN(date.getTime()) ? date : undefined
}

/** Numbers, ids and addresses in a message, so "user 41 not found" and "user 42 not found" group. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '<email>')
    .replace(/\bhttps?:\/\/\S+/g, '<url>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\d+(\.\d+)?/g, '<n>')
    .slice(0, 500)
}

/** A file name without the content hash bundlers add, so a new build keeps the same issue. */
function stableFilename(name: string): string {
  return name
    .replace(/[.-][0-9a-zA-Z_-]{6,}(?=\.(m?js|css)$)/, '')
    .replace(/\b[0-9a-f]{16,}\b/g, '')
}

/**
 * The parts that make two events the same issue: the error's type and where it
 * happened (the app's own frames, or every frame when none is the app's), or
 * the message with numbers and ids taken out when there is no stack.
 */
export function defaultGrouping(exceptions: ErrorException[], message: string): string[] {
  const main = exceptions.at(-1)
  if (main) {
    const own = main.frames.filter((frame) => frame.in_app)
    const frames = (own.length > 0 ? own : main.frames).slice(-10)
    if (frames.length > 0) {
      return [
        main.type || 'Error',
        ...frames.map((f) => `${f.module || stableFilename(f.filename)}|${f.function}`),
      ]
    }
    return [main.type || 'Error', normalizeMessage(main.value)]
  }
  return ['message', normalizeMessage(message)]
}

export function fingerprintOf(parts: string[]): string {
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32)
}

/** `fingerprint` sent by the app wins; `{{ default }}` in it stands for the usual grouping. */
function groupingOf(event: Json, fallback: string[]): string[] {
  const custom = Array.isArray(event.fingerprint)
    ? event.fingerprint.map((part) => str(part, 200)).filter(Boolean)
    : []
  if (custom.length === 0) return fallback
  return custom.flatMap((part) => (/^\{\{\s*default\s*\}\}$/.test(part) ? fallback : [part]))
}

/** "CartTotal in app/checkout/page.tsx": the app's innermost frame. */
function culpritOf(exceptions: ErrorException[], event: Json): string {
  const frames = exceptions.at(-1)?.frames ?? []
  const frame = [...frames].reverse().find((f) => f.in_app) ?? frames.at(-1)
  if (frame) {
    const where = frame.filename || frame.module || ''
    return (frame.function ? `${frame.function} in ${where}` : where).slice(0, 500)
  }
  return str(event.transaction, 500) || str(event.culprit, 500)
}

function header(headers: unknown, name: string): string {
  const lower = name.toLowerCase()
  if (Array.isArray(headers)) {
    const pair = headers.find(
      (h): h is [string, unknown] => Array.isArray(h) && String(h[0]).toLowerCase() === lower,
    )
    return pair ? str(pair[1]) : ''
  }
  for (const [key, value] of Object.entries(obj(headers) ?? {})) {
    if (key.toLowerCase() === lower) return str(value)
  }
  return ''
}

/**
 * One error event as the worker queues it. The browser, system and country
 * come from the event when it says so (a server SDK reporting for a visitor),
 * else from the request. The person is what the app sent as its user; with no
 * user, a browser's daily visitor hash marked `v:`.
 */
export async function toErrorRow(
  scope: IngestScope,
  raw: unknown,
  sender: Sender,
  received: Date = new Date(),
  /** What the SDK sent, when `raw` was built from another format (PostHog's `$exception`). */
  original: unknown = raw,
): Promise<QueuedError | null> {
  const event = obj(raw)
  if (!event) return null
  const exceptions = exceptionsOf(event)
  const message = messageOf(event)
  if (exceptions.length === 0 && !message) return null

  const main = exceptions.at(-1)
  const at = timeOf(event.timestamp)
  const time = !at || at.getTime() - received.getTime() > MAX_FUTURE_MS ? received : at
  const request = obj(event.request) ?? {}
  const url = str(request.url, 2000)
  let path = ''
  try {
    path = url ? new URL(url).pathname.slice(0, 1000) : ''
  } catch {
    path = url.startsWith('/') ? url.slice(0, 1000) : ''
  }
  const contexts = obj(event.contexts) ?? {}
  const userAgent = header(request.headers, 'user-agent') || sender.userAgent
  const client = parseUserAgent(userAgent)
  const user = obj(event.user) ?? {}
  // A user id helps find the person's support case and is kept; an e-mail or a
  // document number is kept only as a hash.
  const sent = str(user.id, 200) || str(user.email, 200) || str(user.username, 200)
  const named = personal(sent) ? `h:${personId(scope.project_id, sent)}` : sent
  const visitor = named ? '' : await sender.visitor(sender.ip, sender.userAgent)
  const sdk = obj(event.sdk)
  const level = str(event.level, 20).toLowerCase()

  return {
    org_id: scope.org_id,
    project_id: scope.project_id,
    source_id: scope.source_id ?? NO_SOURCE,
    event_id: /^[0-9a-f]{32}$/.test(str(event.event_id))
      ? str(event.event_id)
      : uuidv7().replaceAll('-', ''),
    fingerprint: fingerprintOf(groupingOf(event, defaultGrouping(exceptions, message))),
    timestamp: toClickHouseTime(time),
    received_at: toClickHouseTime(received),
    type: main?.type ?? '',
    value: main ? main.value : message,
    level: ['fatal', 'error', 'warning', 'info', 'debug'].includes(level) ? level : 'error',
    handled: main?.mechanism?.handled === false ? 0 : 1,
    platform: str(event.platform, 50) || 'other',
    sdk: str(sdk?.name, 100),
    release: str(event.release, 200),
    environment: str(event.environment, 100),
    culprit: culpritOf(exceptions, event),
    url,
    path,
    browser: str(obj(contexts.browser)?.name, 100) || client.browser,
    os: str(obj(contexts.os)?.name, 100) || client.os,
    country: sender.country,
    person: named || (visitor ? `v:${visitor}` : ''),
    exception: JSON.stringify(exceptions),
    breadcrumbs: JSON.stringify(breadcrumbsOf(event)),
    tags: JSON.stringify(tagsOf(event)),
    trace_id: traceIdOf(contexts),
    // Everything the SDK sent, masked, for what the columns above do not keep.
    event: JSON.stringify(maskDeep(scope.project_id, original).value),
  }
}

/** The trace the error happened in (Sentry's `contexts.trace.trace_id`), lowercase hex. */
function traceIdOf(contexts: Json): string {
  const id = str(obj(contexts.trace)?.trace_id, 64).toLowerCase()
  return /^[0-9a-f]{16,32}$/.test(id) ? id : ''
}

export interface EnvelopeItem {
  type: string
  /** The item's own header line (type, length, content_type, filename...). */
  header: Json
  payload: Uint8Array
}

/**
 * Reads a Sentry envelope: a JSON header line, then items, each a JSON header
 * line and a payload of `length` bytes (or up to the next newline).
 */
export function parseEnvelope(body: Uint8Array): { header: Json; items: EnvelopeItem[] } {
  const decoder = new TextDecoder()
  let at = 0
  const line = (): Uint8Array => {
    const end = body.indexOf(10, at)
    const stop = end === -1 ? body.length : end
    const out = body.subarray(at, stop)
    at = stop + 1
    return out
  }
  const header = obj(JSON.parse(decoder.decode(line()) || '{}')) ?? {}
  const items: EnvelopeItem[] = []
  while (at < body.length) {
    const head = decoder.decode(line()).trim()
    if (!head) continue
    const item = obj(JSON.parse(head)) ?? {}
    const length = num(item.length)
    let payload: Uint8Array
    if (length !== undefined) {
      payload = body.subarray(at, at + length)
      at += length
      if (body[at] === 10) at++
    } else {
      payload = line()
    }
    items.push({ type: str(item.type, 50), header: item, payload })
  }
  return { header, items }
}

/** The public key in a Sentry DSN, an `X-Sentry-Auth` header or the `sentry_key` query. */
export function sentryKey(...candidates: (string | undefined | null)[]): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue
    const found =
      candidate.match(/sentry_key=([0-9a-f]{32})/i)?.[1] ??
      candidate.match(/^[a-z]+:\/\/([0-9a-f]{32})(?::[^@]*)?@/i)?.[1] ??
      (/^[0-9a-f]{32}$/i.test(candidate) ? candidate : undefined)
    if (found) return found.toLowerCase()
  }
  return undefined
}
