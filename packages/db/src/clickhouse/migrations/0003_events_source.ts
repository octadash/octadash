import type { ClickHouseMigration } from '../migrate'

/**
 * The source that sent each event ("Site", "API"). The zero UUID marks events
 * sent with a key from before sources.
 */
export const migration: ClickHouseMigration = {
  name: '0003_events_source',
  statements: [
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS source_id UUID
      DEFAULT toUUID('00000000-0000-0000-0000-000000000000') AFTER project_id`,
  ],
}
