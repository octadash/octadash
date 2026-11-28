import type { ClickHouseClient } from '@clickhouse/client'

/** One row of `spans`, as the worker writes it. */
export interface SpanRow {
  org_id: string
  project_id: string
  source_id: string
  /** Start, UTC with nanoseconds: "2026-11-28 12:00:00.123456789". */
  timestamp: string
  duration_ns: number
  trace_id: string
  span_id: string
  parent_span_id: string
  trace_state: string
  name: string
  /** internal, server, client, producer, consumer or unspecified. */
  kind: string
  service: string
  scope: string
  scope_version: string
  /** unset, ok or error. */
  status_code: string
  status_message: string
  attributes: Record<string, string>
  resource: Record<string, string>
  /** JSON list of `{ time, name, attributes }`. */
  events: string
  /** JSON list of `{ trace_id, span_id, trace_state, attributes }`. */
  links: string
  /** Attributes, events and links the SDK reported leaving out. */
  dropped: number
  masked: number
  retention_days: number
}

/** What the ingest queues: the worker adds the retention. */
export type QueuedSpan = Omit<SpanRow, 'retention_days'>

/** Days spans are kept unless OCTADASH_TRACE_RETENTION_DAYS says otherwise. */
export const DEFAULT_TRACE_RETENTION_DAYS = 14

export async function insertSpans(client: ClickHouseClient, rows: SpanRow[], token?: string) {
  if (rows.length === 0) return
  await client.insert({
    table: 'spans',
    values: rows,
    format: 'JSONEachRow',
    clickhouse_settings: token ? { insert_deduplication_token: token } : {},
  })
}
