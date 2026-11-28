import type { ClickHouseMigration } from '../migrate'

/**
 * Everything the ingest receives that no area reads yet, kept as it came
 * (masked): Sentry sessions, check-ins, feedback and client reports, PostHog
 * autocapture, web vitals and profile updates, and any kind an SDK starts
 * sending tomorrow. An area that comes later reads its history from here.
 * `kind` says what each row is (`sentry.session`, `posthog.$autocapture`);
 * a row whose kind starts with `dropped:` holds no data, only how much of
 * that kind was left out and why, so nothing goes missing without a count.
 * Parts are cut by retention and day, like `logs`, so the TTL drops whole
 * parts.
 */
export const migration: ClickHouseMigration = {
  name: '0009_received',
  statements: [
    `CREATE TABLE IF NOT EXISTS received (
      org_id UUID,
      project_id UUID,
      source_id UUID,
      kind LowCardinality(String),
      timestamp DateTime64(3, 'UTC'),
      received_at DateTime64(3, 'UTC'),
      payload String CODEC(ZSTD(3)),
      encoding LowCardinality(String),
      bytes UInt32,
      masked UInt16,
      retention_days UInt16
    )
    ENGINE = MergeTree
    PARTITION BY (retention_days, toYYYYMMDD(timestamp))
    ORDER BY (org_id, project_id, kind, timestamp)
    TTL toDateTime(timestamp) + toIntervalDay(retention_days)
    SETTINGS ttl_only_drop_parts = 1, non_replicated_deduplication_window = 1000`,
  ],
}
