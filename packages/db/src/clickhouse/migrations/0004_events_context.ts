import type { ClickHouseMigration } from '../migrate'

/**
 * What Traffic reads on every query, as columns instead of JSON: the page,
 * where the visit came from, the browser, the country and the visitor. The
 * ingest fills them; the raw address is never stored. `visitor_id` is a hash
 * that changes every day (see apps/ingest/src/visitor.ts). Bots are kept, with
 * `is_bot`, so they can be shown apart instead of silently missing.
 */
const columns = [
  'visitor_id String',
  'path String',
  'host LowCardinality(String)',
  'referrer_host LowCardinality(String)',
  'utm_source LowCardinality(String)',
  'utm_medium LowCardinality(String)',
  'utm_campaign String',
  'browser LowCardinality(String)',
  'os LowCardinality(String)',
  'device LowCardinality(String)',
  'country LowCardinality(String)',
  'is_bot UInt8',
]

export const migration: ClickHouseMigration = {
  name: '0004_events_context',
  statements: columns.map((column) => `ALTER TABLE events ADD COLUMN IF NOT EXISTS ${column}`),
}
