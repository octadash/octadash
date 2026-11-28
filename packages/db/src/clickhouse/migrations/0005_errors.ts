import type { ClickHouseMigration } from '../migrate'

/**
 * Error occurrences. The issue they belong to is a record in Postgres
 * (`error_issue`); each event lands here with its id, ordered by issue so an
 * issue's page reads one range. `exception` and `breadcrumbs` are JSON kept
 * as text: they are read for one event at a time, never aggregated. `person`
 * is what the app sent as the user (an id, else an e-mail or name) or, when
 * nothing was sent, the daily visitor hash; the address is never stored.
 * 90 days by default; per-area retention changes it with MODIFY TTL.
 */
export const migration: ClickHouseMigration = {
  name: '0005_errors',
  statements: [
    `CREATE TABLE IF NOT EXISTS errors (
      org_id UUID,
      project_id UUID,
      source_id UUID,
      issue_id UUID,
      event_id String,
      fingerprint String,
      timestamp DateTime64(3, 'UTC'),
      received_at DateTime64(3, 'UTC'),
      type String,
      value String CODEC(ZSTD(3)),
      level LowCardinality(String),
      handled UInt8,
      platform LowCardinality(String),
      sdk LowCardinality(String),
      release LowCardinality(String),
      environment LowCardinality(String),
      culprit String,
      url String,
      path String,
      browser LowCardinality(String),
      os LowCardinality(String),
      country LowCardinality(String),
      person String,
      exception String CODEC(ZSTD(3)),
      breadcrumbs String CODEC(ZSTD(3)),
      tags String CODEC(ZSTD(3))
    )
    ENGINE = MergeTree
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (org_id, project_id, issue_id, timestamp)
    TTL toDateTime(timestamp) + toIntervalDay(90)
    SETTINGS ttl_only_drop_parts = 1, non_replicated_deduplication_window = 1000`,
  ],
}
