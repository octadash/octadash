import { type EventRow, NO_SOURCE } from '@octadash/db'
import { describe, expect, it } from 'vitest'
import { EventRouter } from './routing'

function row(project: string, event: string, source = 's1'): EventRow {
  return {
    org_id: 'o',
    project_id: project,
    source_id: source,
    uuid: crypto.randomUUID(),
    timestamp: '2026-11-28 12:00:00.000',
    received_at: '2026-11-28 12:00:00.000',
    event,
    distinct_id: '',
    session_id: '',
    properties: '{}',
  }
}

function setup(dismissed: Record<string, string[]>) {
  const calls = { loads: 0, discarded: [] as unknown[], fed: [] as unknown[] }
  let now = 0
  const router = new EventRouter({
    loadDismissed: async (ids) => {
      calls.loads++
      return new Map(ids.map((id) => [id, new Set(dismissed[id] ?? [])]))
    },
    recordDiscarded: async (rows) => {
      calls.discarded.push(...rows)
    },
    addSourceAreas: async (pairs) => {
      calls.fed.push(...pairs)
    },
    now: () => now,
  })
  return { router, calls, advance: (ms: number) => (now += ms) }
}

describe('EventRouter', () => {
  it('drops and counts events of a dismissed area, keeps the rest', async () => {
    const { router, calls } = setup({ p1: ['usage'] })
    const kept = await router.route([
      row('p1', '$pageview'),
      row('p1', 'signup'),
      row('p1', 'login'),
      row('p2', 'signup'),
    ])
    expect(kept.map((r) => [r.project_id, r.event])).toEqual([
      ['p1', '$pageview'],
      ['p2', 'signup'],
    ])
    expect(calls.discarded).toEqual([{ project_id: 'p1', area: 'usage', count: 2 }])
  })

  it('adds a new area to the source once, and skips keys from before sources', async () => {
    const { router, calls } = setup({})
    await router.route([row('p1', '$pageview'), row('p1', 'signup'), row('p1', 'x', NO_SOURCE)])
    await router.route([row('p1', '$pageview')])
    expect(calls.fed).toEqual([
      { source_id: 's1', area: 'traffic' },
      { source_id: 's1', area: 'usage' },
    ])
  })

  it('reads dismissed areas again after a minute', async () => {
    const { router, calls, advance } = setup({})
    await router.route([row('p1', 'a')])
    await router.route([row('p1', 'a')])
    expect(calls.loads).toBe(1)
    advance(60_000)
    await router.route([row('p1', 'a')])
    expect(calls.loads).toBe(2)
  })
})
