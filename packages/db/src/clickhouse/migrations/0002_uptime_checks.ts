import type { ClickHouseMigration } from '../migrate'

/**
 * One row per uptime check, written by the worker in batches. Heartbeats add a
 * row when a ping arrives and when silence turns into an outage. `cert_days`
 * is filled only by the deeper checks (about once an hour per monitor).
 */
export const migration: ClickHouseMigration = {
  name: '0002_uptime_checks',
  statements: [
    `CREATE TABLE IF NOT EXISTS uptime_checks (
      org_id UUID,
      project_id UUID,
      monitor_id UUID,
      timestamp DateTime64(3, 'UTC'),
      up UInt8,
      status_code Nullable(UInt16),
      duration_ms Nullable(UInt32),
      error String,
      cert_days Nullable(Int32),
      region LowCardinality(String) DEFAULT 'local'
    )
    ENGINE = MergeTree
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (org_id, project_id, monitor_id, timestamp)
    TTL toDateTime(timestamp) + toIntervalMonth(13)
    SETTINGS ttl_only_drop_parts = 1, non_replicated_deduplication_window = 1000`,
  ],
}
