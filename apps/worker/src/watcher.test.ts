import { createLogger } from '@octadash/core'
import { describe, expect, it } from 'vitest'
import { Watcher } from './watcher'

function setup(options: { url?: string | null; fail?: boolean } = {}) {
  const state = {
    url: options.url === undefined ? 'https://hc-ping.com/abc' : options.url,
    fail: options.fail ?? false,
    now: Date.parse('2026-11-28T12:00:00Z'),
    pings: [] as string[],
    records: [] as { status: string; error: string | null }[],
  }
  const watcher = new Watcher({
    loadUrl: async () => state.url,
    ping: async (url) => {
      state.pings.push(url)
      if (state.fail) throw new Error('timeout')
    },
    record: async (status, error) => {
      state.records.push({ status, error })
    },
    now: () => state.now,
    log: createLogger('test', 'fatal'),
  })
  return { state, watcher }
}

describe('outside watcher', () => {
  it('does nothing until a URL is set', async () => {
    const { state, watcher } = setup({ url: null })
    await watcher.tick()
    expect(state.pings).toEqual([])
    expect(state.records).toEqual([])
  })

  it('pings every tick but writes only changes and a refresh every 10 minutes', async () => {
    const { state, watcher } = setup()
    await watcher.tick()
    state.now += 60_000
    await watcher.tick()
    expect(state.pings).toHaveLength(2)
    expect(state.records).toEqual([{ status: 'ok', error: null }])

    state.fail = true
    state.now += 60_000
    await watcher.tick()
    expect(state.records.at(-1)).toEqual({ status: 'failing', error: 'timeout' })

    state.fail = false
    state.now += 60_000
    await watcher.tick()
    state.now += 11 * 60_000
    await watcher.tick()
    expect(state.records.map((r) => r.status)).toEqual(['ok', 'failing', 'ok', 'ok'])
  })

  it('starts over when the URL changes', async () => {
    const { state, watcher } = setup()
    await watcher.tick()
    state.url = 'https://hc-ping.com/new'
    state.now += 60_000
    await watcher.tick()
    expect(state.records).toHaveLength(2)
    expect(state.pings.at(-1)).toBe('https://hc-ping.com/new')
  })
})
