import type { ClickHouseMigration } from '../migrate'

/** The trace an error happened in, so a log line finds its error and back. */
export const migration: ClickHouseMigration = {
  name: '0007_errors_trace',
  statements: [
    `ALTER TABLE errors ADD COLUMN IF NOT EXISTS trace_id String DEFAULT ''`,
    `ALTER TABLE errors ADD INDEX IF NOT EXISTS trace trace_id TYPE bloom_filter(0.01) GRANULARITY 4`,
  ],
}
