import type { ClickHouseMigration } from '../migrate'

/**
 * Data points from OpenTelemetry metrics, every type in one table: gauges and
 * sums in `value`, histograms in `count`, `sum`, `min`, `max` and their
 * buckets, and what only exponential histograms and summaries have (their
 * buckets, quantiles) plus exemplars, which link a point to a trace, in
 * `extra` as JSON. Kept before a Metrics screen exists, so it starts with
 * history. Parts are cut by retention and day, like `logs`.
 */
export const migration: ClickHouseMigration = {
  name: '0011_metrics',
  statements: [
    `CREATE TABLE IF NOT EXISTS metrics (
      org_id UUID,
      project_id UUID,
      source_id UUID,
      timestamp DateTime64(9, 'UTC'),
      start_timestamp DateTime64(9, 'UTC'),
      name LowCardinality(String),
      description String,
      unit LowCardinality(String),
      type LowCardinality(String),
      temporality LowCardinality(String),
      is_monotonic UInt8,
      service LowCardinality(String),
      scope LowCardinality(String),
      attributes Map(LowCardinality(String), String) CODEC(ZSTD(3)),
      resource Map(LowCardinality(String), String) CODEC(ZSTD(3)),
      value Nullable(Float64),
      count UInt64,
      sum Nullable(Float64),
      min Nullable(Float64),
      max Nullable(Float64),
      bucket_counts Array(UInt64),
      explicit_bounds Array(Float64),
      extra String CODEC(ZSTD(3)),
      flags UInt32,
      masked UInt16,
      retention_days UInt16
    )
    ENGINE = MergeTree
    PARTITION BY (retention_days, toYYYYMMDD(timestamp))
    ORDER BY (org_id, project_id, name, timestamp)
    TTL toDateTime(timestamp) + toIntervalDay(retention_days)
    SETTINGS ttl_only_drop_parts = 1, non_replicated_deduplication_window = 1000`,
  ],
}
