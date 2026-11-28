import type { ClickHouseClient } from '@clickhouse/client'

/** One row of `received`, as the worker writes it. */
export interface ReceivedRow {
  org_id: string
  project_id: string
  source_id: string
  /** What the row is: `sentry.session`, `posthog.$autocapture`, `dropped:sentry.attachment`. */
  kind: string
  /** When it happened, as the sender said; the arrival time when it did not say. */
  timestamp: string
  received_at: string
  /** JSON as sent (masked), or base64 for a binary item. Empty for a `dropped:` row. */
  payload: string
  /** `json`, `text` or `base64`. */
  encoding: 'json' | 'text' | 'base64'
  /** Size of the item as it arrived. */
  bytes: number
  /** Values masked before storing. */
  masked: number
  retention_days: number
}

/** What the ingest queues: the worker adds the retention. */
export type QueuedReceived = Omit<ReceivedRow, 'retention_days'>

/** Prefix of the rows that count what was left out instead of holding it. */
export const DROPPED_PREFIX = 'dropped:'

/** Days received data is kept unless OCTADASH_RECEIVED_RETENTION_DAYS says otherwise. */
export const DEFAULT_RECEIVED_RETENTION_DAYS = 30

export async function insertReceived(
  client: ClickHouseClient,
  rows: ReceivedRow[],
  token?: string,
) {
  if (rows.length === 0) return
  await client.insert({
    table: 'received',
    values: rows,
    format: 'JSONEachRow',
    clickhouse_settings: token ? { insert_deduplication_token: token } : {},
  })
}
