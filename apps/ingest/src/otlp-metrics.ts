import {
  flatten,
  hex,
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
 * OpenTelemetry metrics over HTTP (`ExportMetricsServiceRequest`), protobuf or
 * JSON, read into one `OtlpPoint` per data point with its metric, resource and
 * scope applied. Every kind of metric is read whole: gauges and sums as a
 * value, histograms with their buckets, exponential histograms and summaries
 * with their own shape in `extra`, and exemplars (which link a point to a
 * trace) kept with the point.
 */

export type MetricType = 'gauge' | 'sum' | 'histogram' | 'exponential_histogram' | 'summary'

export interface OtlpPoint {
  name: string
  description: string
  unit: string
  type: MetricType
  /** 0 unspecified, 1 delta, 2 cumulative. */
  temporality: number
  isMonotonic: boolean
  timeUnixNano: bigint
  startTimeUnixNano: bigint
  /** Gauge and sum. */
  value: number | null
  /** Histograms and summaries. */
  count: number
  sum: number | null
  min: number | null
  max: number | null
  bucketCounts: number[]
  explicitBounds: number[]
  /** Exponential histogram buckets, summary quantiles, exemplars. */
  extra: Record<string, unknown>
  flags: number
  scope: string
  attributes: Record<string, string>
  resource: Record<string, string>
}

interface MetricInfo {
  name: string
  description: string
  unit: string
  type: MetricType
  temporality: number
  isMonotonic: boolean
}

function blankPoint(info: MetricInfo, scope: string, resource: Record<string, string>): OtlpPoint {
  return {
    ...info,
    timeUnixNano: 0n,
    startTimeUnixNano: 0n,
    value: null,
    count: 0,
    sum: null,
    min: null,
    max: null,
    bucketCounts: [],
    explicitBounds: [],
    extra: {},
    flags: 0,
    scope,
    attributes: {},
    resource,
  }
}

// ---------------------------------------------------------------------------
// Protobuf

const zigzag = (n: bigint) => Number((n >> 1n) ^ -(n & 1n))

/** A repeated fixed64 or double, packed (wire 2) or not (wire 1). */
function repeated64(r: Reader, wire: number, read: (x: Reader) => number, into: number[]) {
  if (wire === 1) {
    into.push(read(r))
    return
  }
  const inner = r.message()
  while (!inner.done) into.push(read(inner))
}
const asCount = (x: Reader) => Number(x.fixed64())
const asDouble = (x: Reader) => x.double()

function readExemplar(r: Reader): Record<string, unknown> {
  const attributes: Record<string, Value> = {}
  const out: Record<string, unknown> = {}
  r.each((n, wire) => {
    if (n === 7 && wire === 2) readAttributes(r.message(), attributes)
    else if (n === 2 && wire === 1) out.time_unix_nano = String(r.fixed64())
    else if (n === 3 && wire === 1) out.value = r.double()
    else if (n === 6 && wire === 1) out.value = Number(BigInt.asIntN(64, r.fixed64()))
    else if (n === 4 && wire === 2) out.span_id = hex(r.bytes())
    else if (n === 5 && wire === 2) out.trace_id = hex(r.bytes())
    else return false
    return true
  })
  out.attributes = flatten(attributes)
  return out
}

function readBuckets(r: Reader): { offset: number; bucket_counts: number[] } {
  const out = { offset: 0, bucket_counts: [] as number[] }
  r.each((n, wire) => {
    if (n === 1 && wire === 0) out.offset = zigzag(r.varint())
    else if (n === 2 && wire === 2) {
      const inner = r.message()
      while (!inner.done) out.bucket_counts.push(Number(inner.varint()))
    } else if (n === 2 && wire === 0) out.bucket_counts.push(Number(r.varint()))
    else return false
    return true
  })
  return out
}

/** One data point of any type; field numbers differ by type, so each has its own table. */
function readPoint(r: Reader, point: OtlpPoint) {
  const attributes: Record<string, Value> = {}
  const exemplars: Record<string, unknown>[] = []
  const quantiles: { quantile: number; value: number }[] = []
  const t = point.type
  const attributesField = t === 'histogram' ? 9 : t === 'exponential_histogram' ? 1 : 7
  const exemplarField =
    t === 'histogram' ? 8 : t === 'exponential_histogram' ? 11 : t === 'summary' ? -1 : 5
  const flagsField =
    t === 'histogram' || t === 'exponential_histogram' ? 10 : t === 'summary' ? 8 : 8
  r.each((n, wire) => {
    if (n === attributesField && wire === 2) readAttributes(r.message(), attributes)
    else if (n === 2 && wire === 1) point.startTimeUnixNano = r.fixed64()
    else if (n === 3 && wire === 1) point.timeUnixNano = r.fixed64()
    else if (n === exemplarField && wire === 2) exemplars.push(readExemplar(r.message()))
    else if (n === flagsField && wire === 0) point.flags = Number(r.varint())
    else if (t === 'gauge' || t === 'sum') {
      if (n === 4 && wire === 1) point.value = r.double()
      else if (n === 6 && wire === 1) point.value = Number(BigInt.asIntN(64, r.fixed64()))
      else return false
    } else if (n === 4 && wire === 1) point.count = Number(r.fixed64())
    else if (n === 5 && wire === 1) point.sum = r.double()
    else if (t === 'histogram') {
      if (n === 6 && (wire === 1 || wire === 2)) repeated64(r, wire, asCount, point.bucketCounts)
      else if (n === 7 && (wire === 1 || wire === 2))
        repeated64(r, wire, asDouble, point.explicitBounds)
      else if (n === 11 && wire === 1) point.min = r.double()
      else if (n === 12 && wire === 1) point.max = r.double()
      else return false
    } else if (t === 'exponential_histogram') {
      if (n === 6 && wire === 0) point.extra.scale = zigzag(r.varint())
      else if (n === 7 && wire === 1) point.extra.zero_count = Number(r.fixed64())
      else if (n === 8 && wire === 2) point.extra.positive = readBuckets(r.message())
      else if (n === 9 && wire === 2) point.extra.negative = readBuckets(r.message())
      else if (n === 12 && wire === 1) point.min = r.double()
      else if (n === 13 && wire === 1) point.max = r.double()
      else if (n === 14 && wire === 1) point.extra.zero_threshold = r.double()
      else return false
    } else if (t === 'summary' && n === 6 && wire === 2) {
      const q = r.message()
      const entry = { quantile: 0, value: 0 }
      q.each((m, w) => {
        if (m === 1 && w === 1) entry.quantile = q.double()
        else if (m === 2 && w === 1) entry.value = q.double()
        else return false
        return true
      })
      quantiles.push(entry)
    } else return false
    return true
  })
  point.attributes = flatten(attributes)
  if (exemplars.length > 0) point.extra.exemplars = exemplars
  if (quantiles.length > 0) point.extra.quantiles = quantiles
}

const TYPE_FIELDS: Record<number, MetricType> = {
  5: 'gauge',
  7: 'sum',
  9: 'histogram',
  10: 'exponential_histogram',
  11: 'summary',
}

function readMetric(r: Reader, scope: string, resource: Record<string, string>): OtlpPoint[] {
  const info: MetricInfo = {
    name: '',
    description: '',
    unit: '',
    type: 'gauge',
    temporality: 0,
    isMonotonic: false,
  }
  let data: Reader | null = null
  r.each((n, wire) => {
    if (n === 1 && wire === 2) info.name = r.string()
    else if (n === 2 && wire === 2) info.description = r.string()
    else if (n === 3 && wire === 2) info.unit = r.string()
    else if (TYPE_FIELDS[n] && wire === 2) {
      info.type = TYPE_FIELDS[n] as MetricType
      data = r.message()
    } else return false
    return true
  })
  const points: OtlpPoint[] = []
  const body = data as Reader | null
  if (!body) return points
  const readers: Reader[] = []
  body.each((n, wire) => {
    if (n === 1 && wire === 2) readers.push(body.message())
    else if (n === 2 && wire === 0) info.temporality = Number(body.varint())
    else if (n === 3 && wire === 0) info.isMonotonic = body.varint() !== 0n
    else return false
    return true
  })
  for (const reader of readers) {
    const point = blankPoint(info, scope, resource)
    readPoint(reader, point)
    points.push(point)
  }
  return points
}

/** Decodes an `ExportMetricsServiceRequest` in protobuf. */
export function decodeMetricsProtobuf(body: Uint8Array): OtlpPoint[] {
  const points: OtlpPoint[] = []
  const top = new Reader(body)
  top.each((n, wire) => {
    if (n !== 1 || wire !== 2) return false
    const rm = top.message()
    const resource: Record<string, Value> = {}
    const scopes: { scope: string; metrics: Reader[] }[] = []
    rm.each((m, w) => {
      if (m === 1 && w === 2) {
        const res = rm.message()
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
        const sm = rm.message()
        const entry = { scope: '', metrics: [] as Reader[] }
        sm.each((k, ww) => {
          if (k === 1 && ww === 2) {
            const scope = sm.message()
            scope.each((s, sw) => {
              if (s === 1 && sw === 2) {
                entry.scope = scope.string()
                return true
              }
              return false
            })
          } else if (k === 2 && ww === 2) entry.metrics.push(sm.message())
          else return false
          return true
        })
        scopes.push(entry)
        return true
      }
      return false
    })
    const flat = flatten(resource)
    for (const { scope, metrics } of scopes) {
      for (const metric of metrics) points.push(...readMetric(metric, scope, flat))
    }
    return true
  })
  return points
}

// ---------------------------------------------------------------------------
// JSON

const TEMPORALITY = ['UNSPECIFIED', 'DELTA', 'CUMULATIVE']
const JSON_TYPES: [key: string, snake: string, type: MetricType][] = [
  ['gauge', 'gauge', 'gauge'],
  ['sum', 'sum', 'sum'],
  ['histogram', 'histogram', 'histogram'],
  ['exponentialHistogram', 'exponential_histogram', 'exponential_histogram'],
  ['summary', 'summary', 'summary'],
]

const numberOf = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

function temporalityOf(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return 0
  const found = TEMPORALITY.findIndex((name) => v.toUpperCase().endsWith(name))
  return Math.max(found, 0)
}

function jsonBuckets(v: unknown) {
  if (!isObject(v)) return undefined
  return {
    offset: numberOf(v.offset) ?? 0,
    bucket_counts: list(pick(v, 'bucketCounts', 'bucket_counts')).map((c) => numberOf(c) ?? 0),
  }
}

/** Reads an `ExportMetricsServiceRequest` in OTLP/JSON. */
export function decodeMetricsJson(body: unknown): OtlpPoint[] {
  if (!isObject(body)) throw new OtlpDecodeError('not an object')
  const points: OtlpPoint[] = []
  for (const rm of list(pick(body, 'resourceMetrics', 'resource_metrics'))) {
    if (!isObject(rm)) continue
    const resource = flatten(jsonAttributes(isObject(rm.resource) ? rm.resource.attributes : []))
    for (const sm of list(pick(rm, 'scopeMetrics', 'scope_metrics'))) {
      if (!isObject(sm)) continue
      const scope = isObject(sm.scope) && typeof sm.scope.name === 'string' ? sm.scope.name : ''
      for (const metric of list(sm.metrics)) {
        if (!isObject(metric)) continue
        const found = JSON_TYPES.find(([key, snake]) => isObject(pick(metric, key, snake)))
        if (!found) continue
        const data = pick(metric, found[0], found[1]) as Json
        const info: MetricInfo = {
          name: String(metric.name ?? ''),
          description: String(metric.description ?? ''),
          unit: String(metric.unit ?? ''),
          type: found[2],
          temporality: temporalityOf(
            pick(data, 'aggregationTemporality', 'aggregation_temporality'),
          ),
          isMonotonic: Boolean(pick(data, 'isMonotonic', 'is_monotonic')),
        }
        for (const dp of list(pick(data, 'dataPoints', 'data_points'))) {
          if (!isObject(dp)) continue
          const point = blankPoint(info, scope, resource)
          point.timeUnixNano = nanos(pick(dp, 'timeUnixNano', 'time_unix_nano'))
          point.startTimeUnixNano = nanos(pick(dp, 'startTimeUnixNano', 'start_time_unix_nano'))
          point.attributes = flatten(jsonAttributes(dp.attributes))
          point.flags = numberOf(dp.flags) ?? 0
          point.value = numberOf(pick(dp, 'asDouble', 'as_double') ?? pick(dp, 'asInt', 'as_int'))
          point.count = numberOf(dp.count) ?? 0
          point.sum = numberOf(dp.sum)
          point.min = numberOf(dp.min)
          point.max = numberOf(dp.max)
          point.bucketCounts = list(pick(dp, 'bucketCounts', 'bucket_counts')).map(
            (c) => numberOf(c) ?? 0,
          )
          point.explicitBounds = list(pick(dp, 'explicitBounds', 'explicit_bounds')).map(
            (c) => numberOf(c) ?? 0,
          )
          if (info.type === 'exponential_histogram') {
            point.extra.scale = numberOf(dp.scale) ?? 0
            point.extra.zero_count = numberOf(pick(dp, 'zeroCount', 'zero_count')) ?? 0
            const positive = jsonBuckets(dp.positive)
            const negative = jsonBuckets(dp.negative)
            if (positive) point.extra.positive = positive
            if (negative) point.extra.negative = negative
          }
          const quantiles = list(pick(dp, 'quantileValues', 'quantile_values'))
            .filter(isObject)
            .map((q) => ({ quantile: numberOf(q.quantile) ?? 0, value: numberOf(q.value) ?? 0 }))
          if (quantiles.length > 0) point.extra.quantiles = quantiles
          const exemplars = list(dp.exemplars).filter(isObject)
          if (exemplars.length > 0) {
            point.extra.exemplars = exemplars.map((e) => ({
              time_unix_nano: String(nanos(pick(e, 'timeUnixNano', 'time_unix_nano'))),
              value: numberOf(pick(e, 'asDouble', 'as_double') ?? pick(e, 'asInt', 'as_int')),
              trace_id: String(pick(e, 'traceId', 'trace_id') ?? '').toLowerCase(),
              span_id: String(pick(e, 'spanId', 'span_id') ?? '').toLowerCase(),
              attributes: flatten(
                jsonAttributes(pick(e, 'filteredAttributes', 'filtered_attributes')),
              ),
            }))
          }
          points.push(point)
        }
      }
    }
  }
  return points
}
