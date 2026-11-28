import type { EventRow, QueuedSpan } from '@octadash/db'
import { describe, expect, it } from 'vitest'
import { aiCallsFromEvents, aiCallsFromSpans } from './ai'

const ids = {
  org_id: '00000000-0000-4000-8000-000000000001',
  project_id: '00000000-0000-4000-8000-000000000002',
  source_id: '00000000-0000-4000-8000-000000000003',
}

const span = (attributes: Record<string, string>, extra: Partial<QueuedSpan> = {}): QueuedSpan => ({
  ...ids,
  timestamp: '2026-11-28 12:00:00.123456789',
  duration_ns: 1_500_000_000,
  trace_id: 't1',
  span_id: 's1',
  parent_span_id: '',
  trace_state: '',
  name: 'chat gpt-4o',
  kind: 'client',
  service: 'api',
  scope: '',
  scope_version: '',
  status_code: 'unset',
  status_message: '',
  attributes,
  resource: {},
  events: '[]',
  links: '[]',
  dropped: 0,
  masked: 0,
  ...extra,
})

describe('aiCallsFromSpans', () => {
  it('reads a gen_ai span and prices it from the list', () => {
    const [call] = aiCallsFromSpans([
      span({
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': 'openai',
        'gen_ai.request.model': 'gpt-4o',
        'gen_ai.response.model': 'gpt-4o-2024-08-06',
        'gen_ai.usage.input_tokens': '1000',
        'gen_ai.usage.output_tokens': '100',
      }),
    ])
    expect(call).toMatchObject({
      origin: 'otel',
      provider: 'openai',
      model: 'gpt-4o-2024-08-06',
      operation: 'chat',
      input_tokens: 1000,
      output_tokens: 100,
      priced: 'list',
      duration_ms: 1500,
      timestamp: '2026-11-28 12:00:00.123',
      is_error: 0,
    })
    expect(call?.cost_micros).toBeGreaterThan(0)
  })

  it('reads the older names and the provider from the list', () => {
    const [call] = aiCallsFromSpans([
      span({
        'gen_ai.request.model': 'claude-sonnet-4-5',
        'gen_ai.usage.prompt_tokens': '10',
        'gen_ai.usage.completion_tokens': '5',
      }),
    ])
    expect(call).toMatchObject({ provider: 'anthropic', input_tokens: 10, output_tokens: 5 })
  })

  it('skips spans that make no call or wrap others', () => {
    expect(
      aiCallsFromSpans([
        span({ 'http.method': 'GET' }),
        span({ 'gen_ai.request.model': 'gpt-4o' }),
        span({
          'gen_ai.operation.name': 'invoke_agent',
          'gen_ai.request.model': 'gpt-4o',
          'gen_ai.usage.input_tokens': '1000',
        }),
      ]),
    ).toEqual([])
  })

  it('keeps tokens of an unlisted model without a cost', () => {
    const [call] = aiCallsFromSpans([
      span(
        { 'gen_ai.request.model': 'house-model-7b', 'gen_ai.usage.input_tokens': '50' },
        { status_code: 'error' },
      ),
    ])
    expect(call).toMatchObject({ priced: 'none', cost_micros: 0, input_tokens: 50, is_error: 1 })
  })
})

const event = (name: string, properties: Record<string, unknown>): EventRow => ({
  ...ids,
  uuid: '00000000-0000-4000-8000-000000000009',
  timestamp: '2026-11-28 12:00:00.000',
  received_at: '2026-11-28 12:00:00.000',
  event: name,
  distinct_id: '',
  session_id: '',
  properties: JSON.stringify(properties),
})

describe('aiCallsFromEvents', () => {
  it('takes the cost the app sent', () => {
    const [call] = aiCallsFromEvents([
      event('$ai_generation', {
        $ai_model: 'gpt-4o-mini',
        $ai_provider: 'openai',
        $ai_input_tokens: 200,
        $ai_output_tokens: 20,
        $ai_total_cost_usd: 0.0123,
        $ai_latency: 0.8,
      }),
      event('signed_up', {}),
    ])
    expect(call).toMatchObject({
      origin: 'posthog',
      cost_micros: 12_300,
      priced: 'sent',
      duration_ms: 800,
      operation: 'chat',
    })
  })

  it('adds Anthropic cached tokens to the input, as PostHog leaves them out', () => {
    const [call] = aiCallsFromEvents([
      event('$ai_generation', {
        $ai_model: 'claude-sonnet-4-5',
        $ai_provider: 'anthropic',
        $ai_input_tokens: 100,
        $ai_output_tokens: 10,
        $ai_cache_read_input_tokens: 900,
      }),
    ])
    expect(call).toMatchObject({ input_tokens: 1000, cache_read_tokens: 900, priced: 'list' })
    // 100 × 3 + 900 × 0.3 + 10 × 15 millionths.
    expect(call?.cost_micros).toBe(300 + 270 + 150)
  })
})
