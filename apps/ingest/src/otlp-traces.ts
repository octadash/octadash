import {
  flatten,
  hex,
  idHex,
  isObject,
  type Json,
  jsonAttributes,
  list,
  nanos,
  OtlpDecodeError,
  pick,
  Reader,
  readAttributes,
  type Value,
} from './otlp'

/**
 * OpenTelemetry traces over HTTP (`ExportTraceServiceRequest`), protobuf or
 * JSON, read into one `OtlpSpan` per span with its resource and scope applied.
 * Same small wire-format reader as logs (otlp.ts), so the bundle needs no
 * generated code.
 */

export interface OtlpSpanEvent {
  timeUnixNano: bigint
  name: string
  attributes: Record<string, string>
}

export interface OtlpSpanLink {
  traceId: string
  spanId: string
  traceState: string
  attributes: Record<string, string>
}

export interface OtlpSpan {
  /** Lowercase hex. */
  traceId: string
  spanId: string
  parentSpanId: string
  traceState: string
  name: string
  /** 0 unspecified, 1 internal, 2 server, 3 client, 4 producer, 5 consumer. */
  kind: number
  startTimeUnixNano: bigint
  endTimeUnixNano: bigint
  /** 0 unset, 1 ok, 2 error. */
  statusCode: number
  statusMessage: string
  scope: string
  scopeVersion: string
  attributes: Record<string, string>
  resource: Record<string, string>
  events: OtlpSpanEvent[]
  links: OtlpSpanLink[]
  /** What the SDK says it had to leave out (attributes, events, links). */
  dropped: number
}

// ---------------------------------------------------------------------------
// Protobuf

function readScope(r: Reader): { name: string; version: string } {
  const out = { name: '', version: '' }
  r.each((n, wire) => {
    if (n === 1 && wire === 2) out.name = r.string()
    else if (n === 2 && wire === 2) out.version = r.string()
    else return false
    return true
  })
  return out
}

function readEvent(r: Reader): OtlpSpanEvent {
  const attributes: Record<string, Value> = {}
  const event: OtlpSpanEvent = { timeUnixNano: 0n, name: '', attributes: {} }
  r.each((n, wire) => {
    if (n === 1 && wire === 1) event.timeUnixNano = r.fixed64()
    else if (n === 2 && wire === 2) event.name = r.string()
    else if (n === 3 && wire === 2) readAttributes(r.message(), attributes)
    else return false
    return true
  })
  event.attributes = flatten(attributes)
  return event
}

function readLink(r: Reader): OtlpSpanLink {
  const attributes: Record<string, Value> = {}
  const link: OtlpSpanLink = { traceId: '', spanId: '', traceState: '', attributes: {} }
  r.each((n, wire) => {
    if (n === 1 && wire === 2) link.traceId = hex(r.bytes())
    else if (n === 2 && wire === 2) link.spanId = hex(r.bytes())
    else if (n === 3 && wire === 2) link.traceState = r.string()
    else if (n === 4 && wire === 2) readAttributes(r.message(), attributes)
    else return false
    return true
  })
  link.attributes = flatten(attributes)
  return link
}

function readSpan(
  r: Reader,
  scope: { name: string; version: string },
  resource: Record<string, string>,
): OtlpSpan {
  const attributes: Record<string, Value> = {}
  const span: OtlpSpan = {
    traceId: '',
    spanId: '',
    parentSpanId: '',
    traceState: '',
    name: '',
    kind: 0,
    startTimeUnixNano: 0n,
    endTimeUnixNano: 0n,
    statusCode: 0,
    statusMessage: '',
    scope: scope.name,
    scopeVersion: scope.version,
    attributes: {},
    resource,
    events: [],
    links: [],
    dropped: 0,
  }
  r.each((n, wire) => {
    if (n === 1 && wire === 2) span.traceId = hex(r.bytes())
    else if (n === 2 && wire === 2) span.spanId = hex(r.bytes())
    else if (n === 3 && wire === 2) span.traceState = r.string()
    else if (n === 4 && wire === 2) span.parentSpanId = hex(r.bytes())
    else if (n === 5 && wire === 2) span.name = r.string()
    else if (n === 6 && wire === 0) span.kind = Number(r.varint())
    else if (n === 7 && wire === 1) span.startTimeUnixNano = r.fixed64()
    else if (n === 8 && wire === 1) span.endTimeUnixNano = r.fixed64()
    else if (n === 9 && wire === 2) readAttributes(r.message(), attributes)
    else if ((n === 10 || n === 12 || n === 14) && wire === 0) span.dropped += Number(r.varint())
    else if (n === 11 && wire === 2) span.events.push(readEvent(r.message()))
    else if (n === 13 && wire === 2) span.links.push(readLink(r.message()))
    else if (n === 15 && wire === 2) {
      const status = r.message()
      status.each((m, w) => {
        if (m === 2 && w === 2) span.statusMessage = status.string()
        else if (m === 3 && w === 0) span.statusCode = Number(status.varint())
        else return false
        return true
      })
    } else return false
    return true
  })
  span.attributes = flatten(attributes)
  return span
}

/** Decodes an `ExportTraceServiceRequest` in protobuf. */
export function decodeTracesProtobuf(body: Uint8Array): OtlpSpan[] {
  const spans: OtlpSpan[] = []
  const top = new Reader(body)
  top.each((n, wire) => {
    if (n !== 1 || wire !== 2) return false
    const rs = top.message()
    const resource: Record<string, Value> = {}
    const scopes: { scope: { name: string; version: string }; spans: Reader[] }[] = []
    rs.each((m, w) => {
      if (m === 1 && w === 2) {
        const res = rs.message()
        res.each((k, ww) => {
          if (k === 1 && ww === 2) {
            readAttributes(res.message(), resource)
            return true
          }
          return false
        })
        return true
      }
      if (m === 2 && w === 2) {
        const ss = rs.message()
        const entry = { scope: { name: '', version: '' }, spans: [] as Reader[] }
        ss.each((k, ww) => {
          if (k === 1 && ww === 2) entry.scope = readScope(ss.message())
          else if (k === 2 && ww === 2) entry.spans.push(ss.message())
          else return false
          return true
        })
        scopes.push(entry)
        return true
      }
      return false
    })
    const flat = flatten(resource)
    for (const { scope, spans: readers } of scopes) {
      for (const reader of readers) spans.push(readSpan(reader, scope, flat))
    }
    return true
  })
  return spans
}

// ---------------------------------------------------------------------------
// JSON

const KINDS = ['UNSPECIFIED', 'INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER']
const STATUS = ['UNSET', 'OK', 'ERROR']

/** An enum sent as a number or as its name ("SPAN_KIND_SERVER", "STATUS_CODE_ERROR"). */
function enumOf(value: unknown, names: string[]): number {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return 0
  const found = names.findIndex((name) => value.toUpperCase().endsWith(`_${name}`))
  return found >= 0 ? found : Number(value) || 0
}

function jsonFlat(v: unknown) {
  return flatten(jsonAttributes(v))
}

/** Reads an `ExportTraceServiceRequest` in OTLP/JSON. */
export function decodeTracesJson(body: unknown): OtlpSpan[] {
  if (!isObject(body)) throw new OtlpDecodeError('not an object')
  const spans: OtlpSpan[] = []
  for (const rs of list(pick(body, 'resourceSpans', 'resource_spans'))) {
    if (!isObject(rs)) continue
    const resource = jsonFlat(isObject(rs.resource) ? rs.resource.attributes : undefined)
    for (const ss of list(pick(rs, 'scopeSpans', 'scope_spans'))) {
      if (!isObject(ss)) continue
      const scope = isObject(ss.scope) ? ss.scope : ({} as Json)
      for (const raw of list(ss.spans)) {
        if (!isObject(raw)) continue
        const status = isObject(raw.status) ? raw.status : ({} as Json)
        const dropped = ['droppedAttributesCount', 'droppedEventsCount', 'droppedLinksCount']
          .map((k) => Number(raw[k] ?? raw[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)]) || 0)
          .reduce((a, b) => a + b, 0)
        spans.push({
          traceId: idHex(pick(raw, 'traceId', 'trace_id')),
          spanId: idHex(pick(raw, 'spanId', 'span_id')),
          parentSpanId: idHex(pick(raw, 'parentSpanId', 'parent_span_id')),
          traceState: String(pick(raw, 'traceState', 'trace_state') ?? ''),
          name: String(raw.name ?? ''),
          kind: enumOf(raw.kind, KINDS),
          startTimeUnixNano: nanos(pick(raw, 'startTimeUnixNano', 'start_time_unix_nano')),
          endTimeUnixNano: nanos(pick(raw, 'endTimeUnixNano', 'end_time_unix_nano')),
          statusCode: enumOf(status.code, STATUS),
          statusMessage: String(status.message ?? ''),
          scope: typeof scope.name === 'string' ? scope.name : '',
          scopeVersion: typeof scope.version === 'string' ? scope.version : '',
          attributes: jsonFlat(raw.attributes),
          resource,
          events: list(raw.events)
            .filter(isObject)
            .map((e) => ({
              timeUnixNano: nanos(pick(e, 'timeUnixNano', 'time_unix_nano')),
              name: String(e.name ?? ''),
              attributes: jsonFlat(e.attributes),
            })),
          links: list(raw.links)
            .filter(isObject)
            .map((l) => ({
              traceId: idHex(pick(l, 'traceId', 'trace_id')),
              spanId: idHex(pick(l, 'spanId', 'span_id')),
              traceState: String(pick(l, 'traceState', 'trace_state') ?? ''),
              attributes: jsonFlat(l.attributes),
            })),
          dropped,
        })
      }
    }
  }
  return spans
}
