import type { ClickHouseMigration } from '../migrate'

/**
 * The whole error event as the SDK sent it, masked: contexts (device, app,
 * runtime, the app's own), extra, request, modules, debug_meta for source
 * maps, frame variables, measurements. The other columns keep what the
 * screens read today; this keeps what a later screen will.
 */
export const migration: ClickHouseMigration = {
  name: '0012_errors_event',
  statements: [
    `ALTER TABLE errors ADD COLUMN IF NOT EXISTS event String DEFAULT '' CODEC(ZSTD(3))`,
  ],
}
