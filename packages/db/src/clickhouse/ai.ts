import type { ClickHouseClient } from '@clickhouse/client'
import { toClickHouseTime } from './events'

/** One model call, as the worker writes it to `ai_calls`. */
export interface AiCallRow {
  org_id: string
  project_id: string
  source_id: string
  /** UTC, "2026-11-28 12:00:00.000". */
  timestamp: string
  /** otel or posthog. */
  origin: string
  provider: string
  model: string
  /** chat, embeddings, generate_content... as the app named it; empty when it did not. */
  operation: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  /** Millionths of a US dollar. */
  cost_micros: number
  /** sent (by the app), list (the price list) or none (a model the list does not have). */
  priced: 'sent' | 'list' | 'none'
  duration_ms: number
  is_error: number
  trace_id: string
  span_id: string
}

export async function insertAiCalls(client: ClickHouseClient, rows: AiCallRow[], token?: string) {
  if (rows.length === 0) return
  await client.insert({
    table: 'ai_calls',
    values: rows,
    format: 'JSONEachRow',
    clickhouse_settings: token ? { insert_deduplication_token: `${token}:ai` } : {},
  })
}

export interface AiScope {
  orgId: string
  projectIds: string[]
  from: Date
  to: Date
}

/** What one product spent on one model in the period. */
export interface AiModelUse {
  projectId: string
  provider: string
  model: string
  calls: number
  errors: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  /** US dollars, from what the app sent and the price list. */
  cost: number
  /** Calls of a model the price list does not have: their tokens count, their cost does not. */
  unpriced: number
}

/** Model calls per product and model in the period, the most expensive first. */
export async function aiModelUse(client: ClickHouseClient, scope: AiScope): Promise<AiModelUse[]> {
  if (scope.projectIds.length === 0) return []
  const result = await client.query({
    query: `SELECT toString(project_id) AS project, provider, model,
        count() AS calls, countIf(is_error = 1) AS errors,
        sum(input_tokens) AS input, sum(output_tokens) AS output,
        sum(cache_read_tokens) AS cache_read, sum(cost_micros) AS micros,
        countIf(priced = 'none') AS unpriced
      FROM ai_calls
      WHERE org_id = {org:UUID} AND project_id IN {projects:Array(UUID)}
        AND timestamp >= {from:DateTime64(3, 'UTC')} AND timestamp < {to:DateTime64(3, 'UTC')}
      GROUP BY project_id, provider, model
      ORDER BY micros DESC, calls DESC`,
    query_params: {
      org: scope.orgId,
      projects: scope.projectIds,
      from: toClickHouseTime(scope.from),
      to: toClickHouseTime(scope.to),
    },
    format: 'JSONEachRow',
  })
  const rows = await result.json<{
    project: string
    provider: string
    model: string
    calls: string
    errors: string
    input: string
    output: string
    cache_read: string
    micros: string
    unpriced: string
  }>()
  return rows.map((r) => ({
    projectId: r.project,
    provider: r.provider,
    model: r.model,
    calls: Number(r.calls),
    errors: Number(r.errors),
    inputTokens: Number(r.input),
    outputTokens: Number(r.output),
    cacheReadTokens: Number(r.cache_read),
    cost: Number(r.micros) / 1e6,
    unpriced: Number(r.unpriced),
  }))
}
