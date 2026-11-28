import type { ClickHouseMigration } from '../migrate'

/**
 * Raw events: page views, product events, anything an SDK sends as an event.
 * Ordered by org_id and project_id first, so one product, one organization or
 * every product is the same query with a different filter. Monthly partitions
 * and `ttl_only_drop_parts` make retention drop whole parts instead of
 * rewriting them. The 13-month TTL is the default; per-area retention settings
 * change it with ALTER TABLE ... MODIFY TTL.
 */
export const migration: ClickHouseMigration = {
  name: '0001_events',
  statements: [
    `CREATE TABLE IF NOT EXISTS events (
      org_id UUID,
      project_id UUID,
      uuid UUID,
      timestamp DateTime64(3, 'UTC'),
      received_at DateTime64(3, 'UTC'),
      event LowCardinality(String),
      distinct_id String,
      session_id String,
      properties String CODEC(ZSTD(3))
    )
    ENGINE = MergeTree
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (org_id, project_id, toDate(timestamp), event, timestamp)
    TTL toDateTime(timestamp) + toIntervalMonth(13)
    SETTINGS ttl_only_drop_parts = 1, non_replicated_deduplication_window = 1000`,
  ],
}
