import type { ClickHouseMigration } from '../migrate'

/**
 * Spans from OpenTelemetry traces (and, later, Sentry transactions), in the
 * shape OpenTelemetry defines so any trace view reads them. Kept even before
 * a Traces screen exists: a log line and an error already carry the trace id
 * that finds them here. Parts are cut by retention and day, like `logs`.
 * `events` and `links` are JSON lists: they are read with their span, never
 * filtered on.
 */
export const migration: ClickHouseMigration = {
  name: '0010_spans',
  statements: [
    `CREATE TABLE IF NOT EXISTS spans (
      org_id UUID,
      project_id UUID,
      source_id UUID,
      timestamp DateTime64(9, 'UTC'),
      duration_ns UInt64,
      trace_id String,
      span_id String,
      parent_span_id String,
      trace_state String,
      name String,
      kind LowCardinality(String),
      service LowCardinality(String),
      scope LowCardinality(String),
      scope_version LowCardinality(String),
      status_code LowCardinality(String),
      status_message String,
      attributes Map(LowCardinality(String), String) CODEC(ZSTD(3)),
      resource Map(LowCardinality(String), String) CODEC(ZSTD(3)),
      events String CODEC(ZSTD(3)),
      links String CODEC(ZSTD(3)),
      dropped UInt32,
      masked UInt16,
      retention_days UInt16,
      INDEX trace trace_id TYPE bloom_filter(0.01) GRANULARITY 4
    )
    ENGINE = MergeTree
    PARTITION BY (retention_days, toYYYYMMDD(timestamp))
    ORDER BY (org_id, project_id, service, timestamp)
    TTL toDateTime(timestamp) + toIntervalDay(retention_days)
    SETTINGS ttl_only_drop_parts = 1, non_replicated_deduplication_window = 1000`,
  ],
}
