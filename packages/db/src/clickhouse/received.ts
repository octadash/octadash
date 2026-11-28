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
  /**
   * `{ meta, body }`: JSON as sent (masked), or base64 for a binary item. For
   * a file, `{ meta, file: { key, bytes, content_type } }`. A `dropped:` row
   * holds `{ reason, count }`.
   */
  payload: string
  /** `json`, `text`, `base64`, or `file` when the body is in file storage. */
  encoding: ReceivedEncoding
  /** Size of the item as it arrived. */
  bytes: number
  /** Values masked before storing. */
  masked: number
  retention_days: number
}

export type ReceivedEncoding = 'json' | 'text' | 'base64' | 'file'

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

/** Files one product received on one day, from the `received` rows that point to them. */
export interface FileUsage {
  /** YYYY-MM-DD, the day the files arrived (the first folder of their keys). */
  day: string
  org_id: string
  project_id: string
  files: number
  bytes: number
}

/** What file storage holds per day and product, for the days given. */
export async function fileUsage(client: ClickHouseClient, days: string[]): Promise<FileUsage[]> {
  if (days.length === 0) return []
  const result = await client.query({
    query: `SELECT toString(toDate(received_at)) AS day, org_id, project_id,
        count() AS files, sum(JSONExtractUInt(payload, 'file', 'bytes')) AS bytes
      FROM received
      WHERE encoding = 'file' AND toDate(received_at) IN {days:Array(Date)}
      GROUP BY day, org_id, project_id
      ORDER BY day, org_id, project_id`,
    query_params: { days },
    format: 'JSONEachRow',
  })
  const rows = await result.json<{
    day: string
    org_id: string
    project_id: string
    files: string
    bytes: string
  }>()
  return rows.map((row) => ({
    ...row,
    files: Number(row.files),
    bytes: Number(row.bytes),
  }))
}
