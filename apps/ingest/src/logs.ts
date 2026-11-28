import { levelOf, levelOfSeverity, NO_SOURCE, type QueuedLog } from '@octadash/db'
import type { IngestScope } from './keys'
import type { OtlpLog } from './otlp'
import { redact, redactAttributes } from './redact'

/** Log lines taken from one request; collectors batch up to about this many. */
export const MAX_LOGS_PER_REQUEST = 10_000
const MAX_BODY_CHARS = 32_000
const MAX_ATTRIBUTES = 128
const MAX_VALUE_CHARS = 4_000
/** A clock this far ahead is wrong; the line takes the time it arrived. */
const MAX_FUTURE_MS = 5 * 60_000

/** Severity numbers that stand for each level, for lines that sent only a word. */
const SEVERITY: Record<string, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
}

function limited(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  let n = 0
  for (const [key, value] of Object.entries(values)) {
    if (n++ >= MAX_ATTRIBUTES) break
    out[key.slice(0, 200)] = value.slice(0, MAX_VALUE_CHARS)
  }
  return out
}

/** "2026-11-28 12:00:00.123456789" from nanoseconds since the epoch. */
export function nanoTime(ns: bigint): string {
  const ms = Number(ns / 1_000_000n)
  const fraction = (ns % 1_000_000_000n).toString().padStart(9, '0')
  const iso = new Date(ms).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}.${fraction}`
}

/**
 * OpenTelemetry records as rows for the `logs` stream: the level read from the
 * severity number or word, the service from the resource, and secrets and
 * personal data masked in the message and every attribute.
 */
export function toLogRows(scope: IngestScope, logs: OtlpLog[], received: Date): QueuedLog[] {
  const receivedNs = BigInt(received.getTime()) * 1_000_000n
  const futureNs = receivedNs + BigInt(MAX_FUTURE_MS) * 1_000_000n
  return logs.slice(0, MAX_LOGS_PER_REQUEST).map((log) => {
    let ns = log.timeUnixNano || log.observedTimeUnixNano || receivedNs
    if (ns > futureNs || ns < 0n) ns = receivedNs
    const level =
      levelOfSeverity(log.severityNumber) ??
      levelOf(log.severityText) ??
      levelOf(log.attributes['log.level'] ?? log.attributes.level ?? '') ??
      'info'
    const body = redact(log.body.slice(0, MAX_BODY_CHARS))
    const attributes = redactAttributes(limited(log.attributes))
    const resource = redactAttributes(limited(log.resource))
    return {
      org_id: scope.org_id,
      project_id: scope.project_id,
      source_id: scope.source_id ?? NO_SOURCE,
      timestamp: nanoTime(ns),
      observed_at: nanoTime(receivedNs).slice(0, 23),
      severity_number:
        log.severityNumber > 0 ? Math.min(24, log.severityNumber) : (SEVERITY[level] ?? 9),
      level,
      service: (log.resource['service.name'] ?? '').slice(0, 100),
      body: body.text,
      trace_id: /^[0-9a-f]{32}$/.test(log.traceId) && !/^0+$/.test(log.traceId) ? log.traceId : '',
      span_id: /^[0-9a-f]{16}$/.test(log.spanId) && !/^0+$/.test(log.spanId) ? log.spanId : '',
      scope: log.scope.slice(0, 200),
      attributes: attributes.attributes,
      resource: resource.attributes,
      masked: Math.min(65_535, body.masked + attributes.masked + resource.masked),
    }
  })
}
