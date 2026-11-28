import type { ClickHouseClient } from '@clickhouse/client'

/** One row of the `events` table, as the ingest queues it and the worker writes it. */
export interface EventRow {
  org_id: string
  project_id: string
  /** NO_SOURCE for a product key from before sources. */
  source_id: string
  uuid: string
  /** UTC, "2026-11-28 12:00:00.000". */
  timestamp: string
  received_at: string
  event: string
  distinct_id: string
  session_id: string
  /** JSON object as a string. */
  properties: string
}

/** `source_id` of events sent with a product key from before sources. */
export const NO_SOURCE = '00000000-0000-0000-0000-000000000000'

/** ClickHouse DateTime64(3) text for a date, in UTC. */
export function toClickHouseTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '')
}

/**
 * Writes rows in one insert. `token` deduplicates a retried batch: ClickHouse
 * ignores an insert whose token it has seen in the last 1000 inserts.
 */
export async function insertEvents(client: ClickHouseClient, rows: EventRow[], token?: string) {
  if (rows.length === 0) return
  await client.insert({
    table: 'events',
    values: rows,
    format: 'JSONEachRow',
    clickhouse_settings: token ? { insert_deduplication_token: token } : {},
  })
}
