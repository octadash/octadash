import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type AiCallRow, aiModelUse, insertAiCalls } from './ai'
import { createClickHouse } from './client'
import { NO_SOURCE } from './events'
import { migrateClickHouse } from './migrate'

const chUrl = process.env.CLICKHOUSE_URL
const org = '00000000-0000-4000-8000-0000000004a1'
const project = '00000000-0000-4000-8000-0000000004a2'

describe.skipIf(!chUrl)('AI calls (needs CLICKHOUSE_URL)', () => {
  const client = chUrl ? createClickHouse(chUrl) : (undefined as never)
  const call = (model: string, extra: Partial<AiCallRow>): AiCallRow => ({
    org_id: org,
    project_id: project,
    source_id: NO_SOURCE,
    timestamp: '2026-11-20 12:00:00.123',
    origin: 'otel',
    provider: 'openai',
    model,
    operation: 'chat',
    input_tokens: 1000,
    output_tokens: 100,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cost_micros: 3500,
    priced: 'list',
    duration_ms: 800,
    is_error: 0,
    trace_id: '',
    span_id: '',
    ...extra,
  })

  beforeAll(async () => {
    await migrateClickHouse(chUrl ?? '')
    await client.command({ query: `DELETE FROM ai_calls WHERE org_id = '${org}'` })
    await insertAiCalls(client, [
      call('gpt-4o', {}),
      call('gpt-4o', { is_error: 1, cost_micros: 1500 }),
      call('house-model', { provider: '', cost_micros: 0, priced: 'none' }),
      call('gpt-4o', { timestamp: '2026-10-01 12:00:00.000' }),
    ])
  })
  afterAll(async () => {
    await client.close()
  })

  it('sums calls per product and model, the most expensive first', async () => {
    const rows = await aiModelUse(client, {
      orgId: org,
      projectIds: [project],
      from: new Date('2026-11-01T00:00:00Z'),
      to: new Date('2026-12-01T00:00:00Z'),
    })
    expect(rows).toEqual([
      {
        projectId: project,
        provider: 'openai',
        model: 'gpt-4o',
        calls: 2,
        errors: 1,
        inputTokens: 2000,
        outputTokens: 200,
        cacheReadTokens: 0,
        cost: 0.005,
        unpriced: 0,
      },
      expect.objectContaining({ model: 'house-model', calls: 1, cost: 0, unpriced: 1 }),
    ])
    expect(
      await aiModelUse(client, { orgId: org, projectIds: [], from: new Date(0), to: new Date() }),
    ).toEqual([])
  })
})
