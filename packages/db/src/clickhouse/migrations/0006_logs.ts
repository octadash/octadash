import type { ClickHouseMigration } from '../migrate'

/**
 * Log lines from OpenTelemetry. Each line keeps the retention its product had
 * when it arrived (`retention_days`), and parts are cut by that and by day, so
 * the nightly TTL drops whole parts: a product on 7 days and one on 90 share
 * the table without slowing each other. `attributes` are the line's own,
 * `resource` the sender's (service.name, host.name...). Text search reads
 * `body` through an n-gram index.
 */
export const migration: ClickHouseMigration = {
  name: '0006_logs',
  statements: [
    `CREATE TABLE IF NOT EXISTS logs (
      org_id UUID,
      project_id UUID,
      source_id UUID,
      timestamp DateTime64(9, 'UTC'),
      observed_at DateTime64(3, 'UTC'),
      severity_number UInt8,
      level LowCardinality(String),
      service LowCardinality(String),
      body String CODEC(ZSTD(3)),
      trace_id String,
      span_id String,
      scope LowCardinality(String),
      attributes Map(LowCardinality(String), String) CODEC(ZSTD(3)),
      resource Map(LowCardinality(String), String) CODEC(ZSTD(3)),
      masked UInt16,
      retention_days UInt16,
      INDEX body_ngrams lower(body) TYPE ngrambf_v1(3, 65536, 2, 0) GRANULARITY 4,
      INDEX trace trace_id TYPE bloom_filter(0.01) GRANULARITY 4
    )
    ENGINE = MergeTree
    PARTITION BY (retention_days, toYYYYMMDD(timestamp))
    ORDER BY (org_id, project_id, timestamp)
    TTL toDateTime(timestamp) + toIntervalDay(retention_days)
    SETTINGS ttl_only_drop_parts = 1, non_replicated_deduplication_window = 1000`,
  ],
}
