import type { ClickHouseMigration } from '../migrate'

/**
 * Traffic and product usage keep what each product chose (3 to 25 months, 13
 * by default), as errors do since 0014: each event keeps the retention its
 * product had when it arrived, and events from before this read 395 days (13
 * months, the TTL they had). Parts are cut by month and mix products, so the
 * TTL removes rows as parts merge instead of dropping whole parts. The new TTL
 * is not applied to the parts already written right away: they hold up to 13
 * months of events, and the rows' default gives them the same date as before.
 */
export const migration: ClickHouseMigration = {
  name: '0015_events_retention',
  statements: [
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS retention_days UInt16 DEFAULT 395`,
    `ALTER TABLE events MODIFY SETTING ttl_only_drop_parts = 0`,
    `ALTER TABLE events MODIFY TTL toDateTime(timestamp) + toIntervalDay(retention_days)
      SETTINGS materialize_ttl_after_modify = 0`,
  ],
}
