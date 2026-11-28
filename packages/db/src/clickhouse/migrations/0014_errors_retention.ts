import type { ClickHouseMigration } from '../migrate'

/**
 * Errors keep what each product chose (30 days to a year, 90 by default).
 * Each event keeps the retention its product had when it arrived, as `logs`
 * does; events from before this read 90. Parts are cut by month and mix
 * products, so the TTL removes rows as parts merge instead of dropping whole
 * parts, which would keep a short retention's events until the longest one
 * in the part expired.
 */
export const migration: ClickHouseMigration = {
  name: '0014_errors_retention',
  statements: [
    `ALTER TABLE errors ADD COLUMN IF NOT EXISTS retention_days UInt16 DEFAULT 90`,
    `ALTER TABLE errors MODIFY SETTING ttl_only_drop_parts = 0`,
    `ALTER TABLE errors MODIFY TTL toDateTime(timestamp) + toIntervalDay(retention_days)`,
  ],
}
