import type { ClickHouseMigration } from '../migrate'

/**
 * One row per model call an app made, read from OpenTelemetry `gen_ai` spans
 * and PostHog `$ai_generation` events: the provider, the model, the tokens and
 * what it cost. `cost_micros` is in millionths of a US dollar; `priced` says
 * where it came from (`sent` by the app, `list` from the price list, `none`
 * for a model the list does not have). The span or event itself is kept too,
 * in `spans` or `events`. Rows carry their retention, as `events` does.
 */
export const migration: ClickHouseMigration = {
  name: '0016_ai_calls',
  statements: [
    `CREATE TABLE IF NOT EXISTS ai_calls (
      org_id UUID,
      project_id UUID,
      source_id UUID,
      timestamp DateTime64(3, 'UTC'),
      origin LowCardinality(String),
      provider LowCardinality(String),
      model LowCardinality(String),
      operation LowCardinality(String),
      input_tokens UInt64,
      output_tokens UInt64,
      cache_read_tokens UInt64,
      cache_write_tokens UInt64,
      cost_micros UInt64,
      priced LowCardinality(String),
      duration_ms UInt32,
      is_error UInt8,
      trace_id String,
      span_id String,
      retention_days UInt16 DEFAULT 395
    )
    ENGINE = MergeTree
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (org_id, project_id, timestamp)
    TTL toDateTime(timestamp) + toIntervalDay(retention_days)
    SETTINGS ttl_only_drop_parts = 0, non_replicated_deduplication_window = 1000`,
  ],
}
