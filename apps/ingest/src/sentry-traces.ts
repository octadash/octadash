import type { OtlpLog } from './otlp'
import type { OtlpSpan } from './otlp-traces'

/**
 * Sentry's tracing and logs, read into the same shapes as OpenTelemetry's, so
 * they land in `spans` and `logs` next to what OTLP sends: a transaction is
 * its root span plus its child spans, a standalone `span` item is one span,
 * and a `log` item is a list of log records.
 */

type Json = Record<string, unknown>
const obj = (v: unknown): Json | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined
const text = (v: unknown, max = 1000) =>
  typeof v === 'string'
    ? v.slice(0, max)
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : ''

/** Seconds since 1970 (with a fraction) or an ISO date, as nanoseconds. */
export function sentryNanos(value: unknown): bigint {
  let ms: number | undefined
  if (typeof value === 'number' && Number.isFinite(value)) ms = value * 1000
  else if (typeof value === 'string' && value) {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) ms = parsed
  }
  return ms === undefined || ms < 0 ? 0n : BigInt(Math.round(ms * 1000)) * 1000n
}

/** Sentry's span statuses: "ok", or one of the error names ("internal_error", "not_found"...). */
function statusCode(status: string): number {
  if (!status) return 0
  return status === 'ok' ? 1 : 2
}

/** A JSON value as an attribute string. */
function value(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

function attributesOf(...groups: [prefix: string, values: unknown][]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [prefix, values] of groups) {
    for (const [key, v] of Object.entries(obj(values) ?? {})) {
      const s = value(v)
      if (s) out[`${prefix}${key}`] = s
    }
  }
  return out
}

function spanOf(raw: Json, extra: Record<string, string>, resource: Record<string, string>) {
  const op = text(raw.op, 200)
  const status = text(raw.status, 100)
  const span: OtlpSpan = {
    traceId: text(raw.trace_id, 64).toLowerCase(),
    spanId: text(raw.span_id, 32).toLowerCase(),
    parentSpanId: text(raw.parent_span_id, 32).toLowerCase(),
    traceState: '',
    name: text(raw.description) || op,
    kind: op === 'http.server' ? 2 : op.startsWith('http.client') || op === 'http' ? 3 : 1,
    startTimeUnixNano: sentryNanos(raw.start_timestamp),
    endTimeUnixNano: sentryNanos(raw.timestamp),
    statusCode: statusCode(status),
    statusMessage: status === 'ok' ? '' : status,
    scope: text(raw.origin, 200),
    scopeVersion: '',
    attributes: {
      ...extra,
      ...(op ? { 'sentry.op': op } : {}),
      ...attributesOf(['', raw.data], ['tags.', raw.tags]),
    },
    resource,
    events: [],
    links: [],
    dropped: 0,
  }
  return span
}

/**
 * The spans of a Sentry transaction: the transaction itself (its trace
 * context, name and measurements) and each child span. What is not a span
 * (request, user, contexts, breadcrumbs) stays on the event, which goes to
 * `received` without its `spans` list.
 */
export function transactionSpans(event: Json): OtlpSpan[] {
  const trace = obj(obj(event.contexts)?.trace) ?? {}
  const sdk = obj(event.sdk)
  const resource: Record<string, string> = {}
  if (text(sdk?.name)) resource['telemetry.sdk.name'] = text(sdk?.name)
  if (text(sdk?.version)) resource['telemetry.sdk.version'] = text(sdk?.version)
  if (text(event.server_name)) resource['host.name'] = text(event.server_name)
  if (text(event.release)) resource['service.version'] = text(event.release)
  if (text(event.environment)) resource['deployment.environment'] = text(event.environment)
  const measurements: Record<string, string> = {}
  for (const [name, m] of Object.entries(obj(event.measurements) ?? {})) {
    const v = obj(m)?.value
    if (typeof v === 'number') measurements[`sentry.measurement.${name}`] = String(v)
  }
  const root = spanOf(
    {
      ...trace,
      description: event.transaction,
      start_timestamp: event.start_timestamp,
      timestamp: event.timestamp,
      tags: event.tags,
    },
    { ...measurements, 'sentry.transaction': text(event.transaction) },
    resource,
  )
  root.kind = text(trace.op) === 'http.server' ? 2 : 1
  const children = (Array.isArray(event.spans) ? event.spans : [])
    .map(obj)
    .filter((s): s is Json => s !== undefined)
    .map((s) => spanOf({ trace_id: root.traceId, ...s }, {}, resource))
  return [root, ...children]
}

/** A standalone `span` item (Sentry's span streaming). */
export function standaloneSpan(item: Json): OtlpSpan {
  return spanOf(item, {}, {})
}

const LEVELS: Record<string, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
}

/**
 * A Sentry `log` item: `{ items: [{ timestamp, level, body, trace_id,
 * attributes: { key: { value, type } } }] }`.
 */
export function sentryLogs(payload: Json): OtlpLog[] {
  const items = Array.isArray(payload.items) ? payload.items : [payload]
  const logs: OtlpLog[] = []
  for (const raw of items) {
    const item = obj(raw)
    if (!item) continue
    const attributes: Record<string, string> = {}
    for (const [key, v] of Object.entries(obj(item.attributes) ?? {})) {
      const s = value(obj(v) && 'value' in (v as Json) ? (v as Json).value : v)
      if (s) attributes[key] = s
    }
    const level = text(item.level, 20).toLowerCase()
    const resource: Record<string, string> = {}
    if (attributes['sentry.environment']) {
      resource['deployment.environment'] = attributes['sentry.environment']
    }
    if (attributes['sentry.release']) resource['service.version'] = attributes['sentry.release']
    if (attributes['server.address']) resource['host.name'] = attributes['server.address']
    logs.push({
      timeUnixNano: sentryNanos(item.timestamp),
      observedTimeUnixNano: 0n,
      severityNumber:
        typeof item.severity_number === 'number' ? item.severity_number : (LEVELS[level] ?? 0),
      severityText: level,
      body: value(item.body),
      traceId: text(item.trace_id, 64).toLowerCase(),
      spanId: text(item.span_id, 32).toLowerCase(),
      scope: text(attributes['sentry.origin'], 200),
      attributes,
      resource,
    })
  }
  return logs
}
