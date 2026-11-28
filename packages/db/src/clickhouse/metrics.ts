import type { ClickHouseClient } from '@clickhouse/client'

/** One row of `metrics`, as the worker writes it. */
export interface MetricRow {
  org_id: string
  project_id: string
  source_id: string
  /** UTC with nanoseconds, "2026-11-28 12:00:00.123456789". */
  timestamp: string
  start_timestamp: string
  name: string
  description: string
  unit: string
  /** gauge, sum, histogram, exponential_histogram or summary. */
  type: string
  /** delta, cumulative or unspecified. */
  temporality: string
  is_monotonic: number
  service: string
  scope: string
  attributes: Record<string, string>
  resource: Record<string, string>
  value: number | null
  count: number
  sum: number | null
  min: number | null
  max: number | null
  bucket_counts: number[]
  explicit_bounds: number[]
  /** JSON: exponential buckets, quantiles, exemplars. */
  extra: string
  flags: number
  masked: number
  retention_days: number
}

/** What the ingest queues: the worker adds the retention. */
export type QueuedMetric = Omit<MetricRow, 'retention_days'>

/** Days metric points are kept unless OCTADASH_METRIC_RETENTION_DAYS says otherwise. */
export const DEFAULT_METRIC_RETENTION_DAYS = 30

export async function insertMetrics(client: ClickHouseClient, rows: MetricRow[], token?: string) {
  if (rows.length === 0) return
  await client.insert({
    table: 'metrics',
    values: rows,
    format: 'JSONEachRow',
    clickhouse_settings: token ? { insert_deduplication_token: token } : {},
  })
}
