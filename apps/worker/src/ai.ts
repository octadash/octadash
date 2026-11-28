import type { AiCallRow, EventRow, QueuedSpan } from '@octadash/db'
import { aiCostMicros, aiPrice } from '@octadash/integrations'

/**
 * Model calls an app reported, for AI cost: OpenTelemetry `gen_ai` spans (the
 * Vercel AI SDK, OpenLLMetry, OpenInference and the official instrumentations
 * send them) and PostHog `$ai_generation` and `$ai_embedding` events. What the
 * app sent as cost wins; otherwise the price list prices the tokens.
 */

/** Spans that wrap calls rather than make one: counting them would count twice. */
const WRAPPERS = new Set(['invoke_agent', 'create_agent', 'execute_tool', 'invoke_workflow'])

const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) && n > 0 ? n : 0
}
const first = (attributes: Record<string, string>, keys: string[]) => {
  for (const key of keys) if (attributes[key] !== undefined) return attributes[key]
  return undefined
}

function priced(
  model: string,
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number },
  sentUsd: number,
) {
  if (sentUsd > 0) return { cost_micros: Math.round(sentUsd * 1e6), priced: 'sent' as const }
  const price = aiPrice(model)
  return price
    ? {
        cost_micros: aiCostMicros(tokens, price),
        priced: 'list' as const,
        provider: price.provider,
      }
    : { cost_micros: 0, priced: 'none' as const }
}

/** UTC with milliseconds: ClickHouse reads `ai_calls.timestamp` at that precision. */
const millis = (time: string) => time.slice(0, 23)

export function aiCallsFromSpans(spans: QueuedSpan[]): AiCallRow[] {
  const rows: AiCallRow[] = []
  for (const span of spans) {
    const a = span.attributes
    const model = first(a, ['gen_ai.response.model', 'gen_ai.request.model']) ?? ''
    const operation = a['gen_ai.operation.name'] ?? ''
    if (!model || WRAPPERS.has(operation)) continue
    const tokens = {
      input: num(first(a, ['gen_ai.usage.input_tokens', 'gen_ai.usage.prompt_tokens'])),
      output: num(first(a, ['gen_ai.usage.output_tokens', 'gen_ai.usage.completion_tokens'])),
      cacheRead: num(
        first(a, ['gen_ai.usage.cache_read.input_tokens', 'gen_ai.usage.cache_read_input_tokens']),
      ),
      cacheWrite: num(
        first(a, [
          'gen_ai.usage.cache_creation.input_tokens',
          'gen_ai.usage.cache_write.input_tokens',
          'gen_ai.usage.cache_creation_input_tokens',
        ]),
      ),
    }
    if (tokens.input + tokens.output === 0) continue
    const cost = priced(model, tokens, 0)
    rows.push({
      org_id: span.org_id,
      project_id: span.project_id,
      source_id: span.source_id,
      timestamp: millis(span.timestamp),
      origin: 'otel',
      provider:
        first(a, ['gen_ai.provider.name', 'gen_ai.system']) ??
        ('provider' in cost ? (cost.provider ?? '') : ''),
      model,
      operation,
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      cache_read_tokens: tokens.cacheRead,
      cache_write_tokens: tokens.cacheWrite,
      cost_micros: cost.cost_micros,
      priced: cost.priced,
      duration_ms: Math.round(span.duration_ns / 1e6),
      is_error: span.status_code === 'error' || a['error.type'] ? 1 : 0,
      trace_id: span.trace_id,
      span_id: span.span_id,
    })
  }
  return rows
}

const AI_EVENTS = new Set(['$ai_generation', '$ai_embedding'])

export function aiCallsFromEvents(events: EventRow[]): AiCallRow[] {
  const rows: AiCallRow[] = []
  for (const event of events) {
    if (!AI_EVENTS.has(event.event)) continue
    let p: Record<string, unknown>
    try {
      p = JSON.parse(event.properties) as Record<string, unknown>
    } catch {
      continue
    }
    const model = typeof p.$ai_model === 'string' ? p.$ai_model : ''
    if (!model) continue
    const provider = typeof p.$ai_provider === 'string' ? p.$ai_provider.toLowerCase() : ''
    const cacheRead = num(p.$ai_cache_read_input_tokens)
    const cacheWrite = num(p.$ai_cache_creation_input_tokens)
    // PostHog passes the provider's own count: Anthropic's leaves cached tokens out.
    const input = num(p.$ai_input_tokens) + (provider === 'anthropic' ? cacheRead + cacheWrite : 0)
    const tokens = { input, output: num(p.$ai_output_tokens), cacheRead, cacheWrite }
    const cost = priced(model, tokens, num(p.$ai_total_cost_usd))
    rows.push({
      org_id: event.org_id,
      project_id: event.project_id,
      source_id: event.source_id,
      timestamp: event.timestamp,
      origin: 'posthog',
      provider: provider || ('provider' in cost ? (cost.provider ?? '') : ''),
      model,
      operation: event.event === '$ai_embedding' ? 'embeddings' : 'chat',
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
      cost_micros: cost.cost_micros,
      priced: cost.priced,
      duration_ms: Math.round(num(p.$ai_latency) * 1000),
      is_error: p.$ai_is_error === true || p.$ai_is_error === 'true' ? 1 : 0,
      trace_id: typeof p.$ai_trace_id === 'string' ? p.$ai_trace_id : '',
      span_id: typeof p.$ai_span_id === 'string' ? p.$ai_span_id : '',
    })
  }
  return rows
}
