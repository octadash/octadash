import { NO_SOURCE, type QueuedSpan } from '@octadash/db'
import type { IngestScope } from './keys'
import { nanoTime } from './logs'
import type { OtlpSpan } from './otlp-traces'
import { redact, redactAttributes } from './redact'

/** Spans taken from one request; more are answered as rejected, so the SDK knows. */
export const MAX_SPANS_PER_REQUEST = 10_000
const MAX_ATTRIBUTES = 128
const MAX_VALUE_CHARS = 4_000
const MAX_EVENTS = 128
const MAX_LINKS = 32
/** A clock this far ahead is wrong; the span takes the time it arrived. */
const MAX_FUTURE_MS = 5 * 60_000

const KINDS = ['unspecified', 'internal', 'server', 'client', 'producer', 'consumer']
const STATUS = ['unset', 'ok', 'error']

function limited(values: Record<string, string>): { values: Record<string, string>; cut: number } {
  const out: Record<string, string> = {}
  let n = 0
  let cut = 0
  for (const [key, value] of Object.entries(values)) {
    if (n++ >= MAX_ATTRIBUTES) {
      cut++
      continue
    }
    out[key.slice(0, 200)] = value.slice(0, MAX_VALUE_CHARS)
  }
  return { values: out, cut }
}

const validId = (id: string, length: number) =>
  id.length === length && /^[0-9a-f]+$/.test(id) && !/^0+$/.test(id) ? id : ''

/**
 * OpenTelemetry spans as rows for the `spans` stream: secrets and personal
 * data masked in the name, every attribute and every event, and what the
 * limits left out added to `dropped` with what the SDK said it left out.
 */
export function toSpanRows(scope: IngestScope, spans: OtlpSpan[], received: Date): QueuedSpan[] {
  const receivedNs = BigInt(received.getTime()) * 1_000_000n
  const futureNs = receivedNs + BigInt(MAX_FUTURE_MS) * 1_000_000n
  const rows: QueuedSpan[] = []
  for (const span of spans.slice(0, MAX_SPANS_PER_REQUEST)) {
    const traceId = validId(span.traceId, 32)
    const spanId = validId(span.spanId, 16)
    if (!traceId || !spanId) continue
    let start = span.startTimeUnixNano || receivedNs
    if (start > futureNs || start < 0n) start = receivedNs
    const end = span.endTimeUnixNano >= span.startTimeUnixNano ? span.endTimeUnixNano : start
    const duration = span.startTimeUnixNano > 0n ? end - span.startTimeUnixNano : 0n

    let masked = 0
    let dropped = span.dropped
    const mask = (values: Record<string, string>) => {
      const cut = limited(values)
      dropped += cut.cut
      const out = redactAttributes(cut.values)
      masked += out.masked
      return out.attributes
    }
    const name = redact(span.name.slice(0, 1000))
    masked += name.masked
    const status = redact(span.statusMessage.slice(0, MAX_VALUE_CHARS))
    masked += status.masked
    dropped +=
      Math.max(0, span.events.length - MAX_EVENTS) + Math.max(0, span.links.length - MAX_LINKS)
    const events = span.events.slice(0, MAX_EVENTS).map((event) => ({
      time: event.timeUnixNano > 0n ? nanoTime(event.timeUnixNano) : '',
      name: redact(event.name.slice(0, 500)).text,
      attributes: mask(event.attributes),
    }))
    const links = span.links.slice(0, MAX_LINKS).map((link) => ({
      trace_id: link.traceId,
      span_id: link.spanId,
      trace_state: link.traceState,
      attributes: mask(link.attributes),
    }))
    rows.push({
      org_id: scope.org_id,
      project_id: scope.project_id,
      source_id: scope.source_id ?? NO_SOURCE,
      timestamp: nanoTime(start),
      duration_ns: Number(duration > 0n ? duration : 0n),
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: validId(span.parentSpanId, 16),
      trace_state: span.traceState.slice(0, 500),
      name: name.text,
      kind: KINDS[span.kind] ?? 'unspecified',
      service: (span.resource['service.name'] ?? '').slice(0, 100),
      scope: span.scope.slice(0, 200),
      scope_version: span.scopeVersion.slice(0, 100),
      status_code: STATUS[span.statusCode] ?? 'unset',
      status_message: status.text,
      attributes: mask(span.attributes),
      resource: mask(span.resource),
      events: JSON.stringify(events),
      links: JSON.stringify(links),
      dropped: Math.min(4_294_967_295, dropped),
      masked: Math.min(65_535, masked),
    })
  }
  return rows
}
