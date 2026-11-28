/**
 * OpenTelemetry logs over HTTP (OTLP/HTTP), in both encodings the SDKs use:
 * protobuf (`application/x-protobuf`, the default of most exporters) and JSON
 * (`application/json`). Protobuf is read by a small wire-format decoder for
 * the few messages of `ExportLogsServiceRequest`, so the ingest bundle needs
 * no generated code or native addon.
 *
 * Both encodings end in the same `OtlpLog` list: one entry per log record,
 * with its resource and scope already applied.
 */

export interface OtlpLog {
  /** Nanoseconds since the epoch (it does not fit a JS number). 0 when unset. */
  timeUnixNano: bigint
  observedTimeUnixNano: bigint
  severityNumber: number
  severityText: string
  /** The message: a string body as sent, any other body as JSON. */
  body: string
  /** Lowercase hex, empty when unset. */
  traceId: string
  spanId: string
  scope: string
  /** The record's own attributes, flattened with dots. */
  attributes: Record<string, string>
  /** The resource's attributes (service.name, host.name...), flattened with dots. */
  resource: Record<string, string>
}

export class OtlpDecodeError extends Error {
  override name = 'OtlpDecodeError'
}

// ---------------------------------------------------------------------------
// Protobuf wire format

export type Value = string | boolean | number | bigint | Value[] | { [key: string]: Value } | null

export class Reader {
  pos = 0
  constructor(
    private readonly buf: Uint8Array,
    private readonly end = buf.length,
  ) {}

  get done() {
    return this.pos >= this.end
  }

  varint(): bigint {
    let result = 0n
    let shift = 0n
    for (;;) {
      if (this.pos >= this.end) throw new OtlpDecodeError('truncated varint')
      const byte = this.buf[this.pos++] as number
      result |= BigInt(byte & 0x7f) << shift
      if ((byte & 0x80) === 0) return result
      shift += 7n
      if (shift > 63n) throw new OtlpDecodeError('varint too long')
    }
  }

  fixed64(): bigint {
    if (this.pos + 8 > this.end) throw new OtlpDecodeError('truncated fixed64')
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8)
    this.pos += 8
    return view.getBigUint64(0, true)
  }

  double(): number {
    if (this.pos + 8 > this.end) throw new OtlpDecodeError('truncated double')
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8)
    this.pos += 8
    return view.getFloat64(0, true)
  }

  bytes(): Uint8Array {
    const length = Number(this.varint())
    if (length < 0 || this.pos + length > this.end) throw new OtlpDecodeError('truncated bytes')
    const out = this.buf.subarray(this.pos, this.pos + length)
    this.pos += length
    return out
  }

  /** A nested message: a reader over its bytes. */
  message(): Reader {
    const bytes = this.bytes()
    return new Reader(bytes)
  }

  string(): string {
    return decoder.decode(this.bytes())
  }

  skip(wire: number) {
    switch (wire) {
      case 0:
        this.varint()
        return
      case 1:
        this.pos += 8
        break
      case 2:
        this.bytes()
        return
      case 5:
        this.pos += 4
        break
      default:
        throw new OtlpDecodeError(`unsupported wire type ${wire}`)
    }
    if (this.pos > this.end) throw new OtlpDecodeError('truncated field')
  }

  /** Calls `field` for each field of the message, which reads it or returns false to skip it. */
  each(field: (number: number, wire: number) => boolean) {
    while (!this.done) {
      const tag = Number(this.varint())
      const number = tag >>> 3
      const wire = tag & 7
      if (!field(number, wire)) this.skip(wire)
    }
  }
}

const decoder = new TextDecoder()
export const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

export function readAnyValue(r: Reader): Value {
  let value: Value = null
  r.each((n, wire) => {
    if (n === 1 && wire === 2) value = r.string()
    else if (n === 2 && wire === 0) value = r.varint() !== 0n
    else if (n === 3 && wire === 0) value = BigInt.asIntN(64, r.varint())
    else if (n === 4 && wire === 1) value = r.double()
    else if (n === 5 && wire === 2) {
      const list: Value[] = []
      const inner = r.message()
      inner.each((m, w) => {
        if (m === 1 && w === 2) {
          list.push(readAnyValue(inner.message()))
          return true
        }
        return false
      })
      value = list
    } else if (n === 6 && wire === 2) {
      const object: Record<string, Value> = {}
      const inner = r.message()
      inner.each((m, w) => {
        if (m === 1 && w === 2) {
          const [k, v] = readKeyValue(inner.message())
          object[k] = v
          return true
        }
        return false
      })
      value = object
    } else if (n === 7 && wire === 2) value = hex(r.bytes())
    else return false
    return true
  })
  return value
}

function readKeyValue(r: Reader): [string, Value] {
  let key = ''
  let value: Value = null
  r.each((n, wire) => {
    if (n === 1 && wire === 2) key = r.string()
    else if (n === 2 && wire === 2) value = readAnyValue(r.message())
    else return false
    return true
  })
  return [key, value]
}

export function readAttributes(r: Reader, into: Record<string, Value>) {
  const [key, value] = readKeyValue(r)
  if (key) into[key] = value
}

/** Decodes an `ExportLogsServiceRequest` in protobuf. */
export function decodeLogsProtobuf(body: Uint8Array): OtlpLog[] {
  const logs: OtlpLog[] = []
  const top = new Reader(body)
  top.each((n, wire) => {
    if (n !== 1 || wire !== 2) return false
    // ResourceLogs
    const rl = top.message()
    const resource: Record<string, Value> = {}
    const scopes: { scope: string; records: Reader[] }[] = []
    rl.each((m, w) => {
      if (m === 1 && w === 2) {
        const res = rl.message()
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
        const sl = rl.message()
        const entry = { scope: '', records: [] as Reader[] }
        sl.each((k, ww) => {
          if (k === 1 && ww === 2) {
            const scope = sl.message()
            scope.each((s, sw) => {
              if (s === 1 && sw === 2) {
                entry.scope = scope.string()
                return true
              }
              return false
            })
            return true
          }
          if (k === 2 && ww === 2) {
            entry.records.push(sl.message())
            return true
          }
          return false
        })
        scopes.push(entry)
        return true
      }
      return false
    })
    const flatResource = flatten(resource)
    for (const { scope, records } of scopes) {
      for (const rec of records) logs.push(readLogRecord(rec, scope, flatResource))
    }
    return true
  })
  return logs
}

function readLogRecord(r: Reader, scope: string, resource: Record<string, string>): OtlpLog {
  const log: OtlpLog = {
    timeUnixNano: 0n,
    observedTimeUnixNano: 0n,
    severityNumber: 0,
    severityText: '',
    body: '',
    traceId: '',
    spanId: '',
    scope,
    attributes: {},
    resource,
  }
  const attributes: Record<string, Value> = {}
  let eventName = ''
  r.each((n, wire) => {
    if (n === 1 && wire === 1) log.timeUnixNano = r.fixed64()
    else if (n === 11 && wire === 1) log.observedTimeUnixNano = r.fixed64()
    else if (n === 2 && wire === 0) log.severityNumber = Number(r.varint())
    else if (n === 3 && wire === 2) log.severityText = r.string()
    else if (n === 5 && wire === 2) log.body = bodyText(readAnyValue(r.message()))
    else if (n === 6 && wire === 2) readAttributes(r.message(), attributes)
    else if (n === 9 && wire === 2) log.traceId = hex(r.bytes())
    else if (n === 10 && wire === 2) log.spanId = hex(r.bytes())
    else if (n === 12 && wire === 2) eventName = r.string()
    else return false
    return true
  })
  log.attributes = flatten(attributes)
  if (eventName && !log.attributes['event.name']) log.attributes['event.name'] = eventName
  return log
}

// ---------------------------------------------------------------------------
// JSON (OTLP/JSON: camelCase names, 64-bit numbers as strings, ids in hex)

export type Json = Record<string, unknown>
export const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
export const pick = (o: Json, camel: string, snake: string) => o[camel] ?? o[snake]

export function jsonAnyValue(v: unknown): Value {
  if (!isObject(v)) return null
  if ('stringValue' in v || 'string_value' in v)
    return String(pick(v, 'stringValue', 'string_value'))
  if ('boolValue' in v || 'bool_value' in v) return Boolean(pick(v, 'boolValue', 'bool_value'))
  if ('intValue' in v || 'int_value' in v) {
    try {
      return BigInt(String(pick(v, 'intValue', 'int_value')))
    } catch {
      return null
    }
  }
  if ('doubleValue' in v || 'double_value' in v) {
    return Number(pick(v, 'doubleValue', 'double_value'))
  }
  const array = pick(v, 'arrayValue', 'array_value')
  if (isObject(array)) return list(array.values).map(jsonAnyValue)
  const kv = pick(v, 'kvlistValue', 'kvlist_value')
  if (isObject(kv)) {
    const object: Record<string, Value> = {}
    for (const item of list(kv.values)) {
      if (isObject(item) && typeof item.key === 'string')
        object[item.key] = jsonAnyValue(item.value)
    }
    return object
  }
  const bytes = pick(v, 'bytesValue', 'bytes_value')
  if (typeof bytes === 'string') return bytes
  return null
}

export function jsonAttributes(v: unknown): Record<string, Value> {
  const out: Record<string, Value> = {}
  for (const item of list(v)) {
    if (isObject(item) && typeof item.key === 'string') out[item.key] = jsonAnyValue(item.value)
  }
  return out
}

export const nanos = (v: unknown): bigint => {
  if (typeof v !== 'string' && typeof v !== 'number') return 0n
  try {
    return BigInt(typeof v === 'number' ? Math.trunc(v) : v)
  } catch {
    return 0n
  }
}

export const idHex = (v: unknown) =>
  typeof v === 'string' && /^[0-9a-fA-F]*$/.test(v) ? v.toLowerCase() : ''

/** Reads an `ExportLogsServiceRequest` in OTLP/JSON. */
export function decodeLogsJson(body: unknown): OtlpLog[] {
  if (!isObject(body)) throw new OtlpDecodeError('not an object')
  const logs: OtlpLog[] = []
  for (const rl of list(pick(body, 'resourceLogs', 'resource_logs'))) {
    if (!isObject(rl)) continue
    const res = isObject(rl.resource) ? rl.resource : {}
    const resource = flatten(jsonAttributes(res.attributes))
    for (const sl of list(pick(rl, 'scopeLogs', 'scope_logs'))) {
      if (!isObject(sl)) continue
      const scope = isObject(sl.scope) && typeof sl.scope.name === 'string' ? sl.scope.name : ''
      for (const rec of list(pick(sl, 'logRecords', 'log_records'))) {
        if (!isObject(rec)) continue
        const attributes = flatten(jsonAttributes(rec.attributes))
        const eventName = pick(rec, 'eventName', 'event_name')
        if (typeof eventName === 'string' && eventName && !attributes['event.name']) {
          attributes['event.name'] = eventName
        }
        logs.push({
          timeUnixNano: nanos(pick(rec, 'timeUnixNano', 'time_unix_nano')),
          observedTimeUnixNano: nanos(pick(rec, 'observedTimeUnixNano', 'observed_time_unix_nano')),
          severityNumber: Number(pick(rec, 'severityNumber', 'severity_number')) || 0,
          severityText: String(pick(rec, 'severityText', 'severity_text') ?? ''),
          body: bodyText(jsonAnyValue(rec.body)),
          traceId: idHex(pick(rec, 'traceId', 'trace_id')),
          spanId: idHex(pick(rec, 'spanId', 'span_id')),
          scope,
          attributes,
          resource,
        })
      }
    }
  }
  return logs
}

// ---------------------------------------------------------------------------
// Shared

export const toJson = (v: Value): unknown => {
  if (typeof v === 'bigint') return Number(v)
  if (Array.isArray(v)) return v.map(toJson)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJson(x)]))
  }
  return v
}

function bodyText(v: Value): string {
  if (v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') return JSON.stringify(toJson(v))
  return String(v)
}

/** Nested maps become dotted keys; lists become JSON. */
export function flatten(
  values: Record<string, Value>,
  prefix = '',
  out: Record<string, string> = {},
) {
  for (const [key, value] of Object.entries(values)) {
    const name = prefix ? `${prefix}.${key}` : key
    if (value === null) continue
    if (Array.isArray(value)) out[name] = JSON.stringify(toJson(value))
    else if (typeof value === 'object') flatten(value, name, out)
    else out[name] = String(value)
  }
  return out
}

/**
 * The answer to an export: empty means everything was accepted. A partial
 * success says how many were rejected and why (or, with none rejected, a
 * warning), in the encoding of the request. Logs, spans and data points share
 * the layout: field 1 the count, field 2 the message.
 */
export function exportAnswer(
  rejected: number,
  message: string,
  encoding: 'json' | 'protobuf',
  kind: 'logs' | 'spans' | 'dataPoints',
): { body: Uint8Array | string; contentType: string } {
  const empty = rejected === 0 && !message
  if (encoding === 'json') {
    const field = {
      logs: 'rejectedLogRecords',
      spans: 'rejectedSpans',
      dataPoints: 'rejectedDataPoints',
    }[kind]
    return {
      body: empty
        ? '{}'
        : JSON.stringify({ partialSuccess: { [field]: String(rejected), errorMessage: message } }),
      contentType: 'application/json',
    }
  }
  if (empty) return { body: new Uint8Array(), contentType: 'application/x-protobuf' }
  const text = new TextEncoder().encode(message)
  const inner = [
    ...(rejected > 0 ? [0x08, ...varint(BigInt(rejected))] : []),
    0x12,
    ...varint(BigInt(text.length)),
    ...text,
  ]
  return {
    body: new Uint8Array([0x0a, ...varint(BigInt(inner.length)), ...inner]),
    contentType: 'application/x-protobuf',
  }
}

function varint(n: bigint): number[] {
  const out: number[] = []
  let v = n
  do {
    let byte = Number(v & 0x7fn)
    v >>= 7n
    if (v > 0n) byte |= 0x80
    out.push(byte)
  } while (v > 0n)
  return out
}
