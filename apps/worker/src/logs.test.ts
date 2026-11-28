import { createLogger } from '@octadash/core'
import type { LogRow, QueuedLog } from '@octadash/db'
import { describe, expect, it } from 'vitest'
import { createLogWriter } from './logs'
import { EventRouter } from './routing'

const line = (project: string): QueuedLog => ({
  org_id: 'o',
  project_id: project,
  source_id: 's1',
  timestamp: '2026-11-28 12:00:00.000000000',
  observed_at: '2026-11-28 12:00:00.000',
  severity_number: 9,
  level: 'info',
  service: 'api',
  body: 'hello',
  trace_id: '',
  span_id: '',
  scope: '',
  attributes: {},
  resource: {},
  masked: 0,
})

describe('log writer', () => {
  it('drops products with Logs off and stamps each line with its product retention', async () => {
    const router = new EventRouter({
      loadDismissed: async (ids) =>
        new Map(ids.map((id) => [id, new Set(id === 'off' ? ['logs'] : [])])),
      recordDiscarded: async () => {},
      addSourceAreas: async () => {},
      now: () => 0,
    })
    const written: LogRow[] = []
    let loads = 0
    const write = createLogWriter({
      router,
      loadRetention: async (ids) => {
        loads++
        return new Map(ids.filter((id) => id === 'p7').map((id) => [id, 7]))
      },
      insert: async (rows) => {
        written.push(...rows)
      },
      log: createLogger('test', 'silent'),
      now: () => 0,
    })
    await write([line('p7'), line('p14'), line('off')], 't1')
    await write([line('p7')], 't2')
    expect(written.map((r) => [r.project_id, r.retention_days])).toEqual([
      ['p7', 7],
      ['p14', 14],
      ['p7', 7],
    ])
    // Retention is cached for a minute.
    expect(loads).toBe(1)
  })
})
