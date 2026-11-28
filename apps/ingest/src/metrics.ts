import { NO_SOURCE, type QueuedMetric } from '@octadash/db'
import type { IngestScope } from './keys'
import { nanoTime } from './logs'
import type { OtlpPoint } from './otlp-metrics'
import { redact, redactAttributes } from './redact'

/** Data points taken from one request; more are answered as rejected, so the SDK knows. */
export const MAX_POINTS_PER_REQUEST = 20_000
const MAX_ATTRIBUTES = 128
const MAX_VALUE_CHARS = 4_000
const MAX_BUCKETS = 512
/** A clock this far ahead is wrong; the point takes the time it arrived. */
const MAX_FUTURE_MS = 5 * 60_000

const TEMPORALITY = ['unspecified', 'delta', 'cumulative']

function limited(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  let n = 0
  for (const [key, value] of Object.entries(values)) {
    if (n++ >= MAX_ATTRIBUTES) break
    out[key.slice(0, 200)] = value.slice(0, MAX_VALUE_CHARS)
  }
  return out
}

const finite = (v: number | null) => (v !== null && Number.isFinite(v) ? v : null)

/** OpenTelemetry data points as rows for the `metrics` stream, attributes masked like logs. */
export function toMetricRows(
  scope: IngestScope,
  points: OtlpPoint[],
  received: Date,
): QueuedMetric[] {
  const receivedNs = BigInt(received.getTime()) * 1_000_000n
  const futureNs = receivedNs + BigInt(MAX_FUTURE_MS) * 1_000_000n
  const rows: QueuedMetric[] = []
  for (const point of points.slice(0, MAX_POINTS_PER_REQUEST)) {
    if (!point.name) continue
    let ns = point.timeUnixNano || receivedNs
    if (ns > futureNs || ns < 0n) ns = receivedNs
    const start =
      point.startTimeUnixNano > 0n && point.startTimeUnixNano <= ns ? point.startTimeUnixNano : ns
    const attributes = redactAttributes(limited(point.attributes))
    const resource = redactAttributes(limited(point.resource))
    const description = redact(point.description.slice(0, 1000))
    rows.push({
      org_id: scope.org_id,
      project_id: scope.project_id,
      source_id: scope.source_id ?? NO_SOURCE,
      timestamp: nanoTime(ns),
      start_timestamp: nanoTime(start),
      name: point.name.slice(0, 300),
      description: description.text,
      unit: point.unit.slice(0, 50),
      type: point.type,
      temporality: TEMPORALITY[point.temporality] ?? 'unspecified',
      is_monotonic: point.isMonotonic ? 1 : 0,
      service: (point.resource['service.name'] ?? '').slice(0, 100),
      scope: point.scope.slice(0, 200),
      attributes: attributes.attributes,
      resource: resource.attributes,
      value: finite(point.value),
      count: Math.max(0, Math.trunc(point.count)),
      sum: finite(point.sum),
      min: finite(point.min),
      max: finite(point.max),
      bucket_counts: point.bucketCounts
        .slice(0, MAX_BUCKETS)
        .map((c) => Math.max(0, Math.trunc(c))),
      explicit_bounds: point.explicitBounds.slice(0, MAX_BUCKETS - 1).filter(Number.isFinite),
      extra: Object.keys(point.extra).length > 0 ? JSON.stringify(point.extra) : '',
      flags: point.flags >>> 0,
      masked: Math.min(65_535, attributes.masked + resource.masked + description.masked),
    })
  }
  return rows
}
