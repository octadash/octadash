import { createLogger } from '@octadash/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decodeEntries, startConsumer } from './consumer'
import { ValkeyHeartbeats } from './heartbeats'
import { type LiveEvent, ValkeyLiveHub, ValkeyLivePublisher } from './live'
import { ValkeySink } from './sink'
import { createValkey, type Redis, STREAMS, WRITERS_GROUP } from './streams'

const url = process.env.VALKEY_URL
const log = createLogger('test', 'silent')

describe('decodeEntries', () => {
  it('flattens batches and sets unreadable entries aside', () => {
    expect(
      decodeEntries([
        ['1-0', ['b', '[{"a":1},{"a":2}]']],
        ['2-0', ['b', 'not json']],
        ['3-0', ['x', '[]']],
      ]),
    ).toEqual({ rows: [{ a: 1 }, { a: 2 }], ids: ['1-0', '2-0', '3-0'], bad: ['2-0', '3-0'] })
  })
})

describe.skipIf(!url)('valkey streams (needs VALKEY_URL)', () => {
  let redis: Redis

  beforeAll(() => {
    redis = createValkey(url ?? '', { name: 'octadash-test' })
  })

  afterAll(async () => {
    await redis.del(STREAMS.events)
    redis.disconnect()
  })

  it('delivers every batch, retries a failed write and deletes what was written', async () => {
    await redis.del(STREAMS.events)
    const sink = new ValkeySink(redis, { pollMs: 50, maxPending: 3 })
    await sink.write('events', [{ n: 1 }])
    await sink.write('events', [{ n: 2 }, { n: 3 }])

    const written: unknown[] = []
    const tokens: string[] = []
    let failures = 1
    const consumer = startConsumer(
      redis,
      'events',
      async (rows, token) => {
        tokens.push(token)
        if (failures-- > 0) throw new Error('clickhouse down')
        written.push(...rows)
      },
      { log, blockMs: 100, consumer: 'test' },
    )
    const deadline = Date.now() + 10_000
    while (written.length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    await consumer.stop()

    expect(written).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }])
    // The retry used the same token, so ClickHouse can drop a duplicate insert.
    expect(tokens[0]).toBe(tokens[1])
    expect(await redis.xlen(STREAMS.events)).toBe(0)
    const pending = (await redis.xpending(STREAMS.events, WRITERS_GROUP)) as [number]
    expect(pending[0]).toBe(0)
    sink.stop()
  })

  it('reports a full queue', async () => {
    await redis.del(STREAMS.events)
    const sink = new ValkeySink(redis, { pollMs: 20, maxPending: 2 })
    expect(sink.isFull('events')).toBe(false)
    await sink.write('events', [{}])
    await sink.write('events', [{}])
    await new Promise((r) => setTimeout(r, 100))
    expect(sink.isFull('events')).toBe(true)
    sink.stop()
  })
  it('records and reads heartbeat pings', async () => {
    const store = new ValkeyHeartbeats(redis)
    const id = crypto.randomUUID()
    await store.record(id, 1_795_000_000_000)
    const pings = await store.read([id, crypto.randomUUID()])
    expect([...pings]).toEqual([[id, 1_795_000_000_000]])
    expect((await store.read([])).size).toBe(0)
    await redis.del(`octadash:hb:${id}`)
  })

  it('keeps the output a job sent with its ping or failure', async () => {
    const store = new ValkeyHeartbeats(redis)
    const id = crypto.randomUUID()
    await store.record(id, 1_000, 'backup ok')
    await store.recordFailure(id, 2_000, 'disk full')
    await store.record(id, 3_000)
    expect([...(await store.readOutputs([id], false))]).toEqual([
      [id, { at: 1_000, output: 'backup ok' }],
    ])
    expect([...(await store.readOutputs([id], true))]).toEqual([
      [id, { at: 2_000, output: 'disk full' }],
    ])
    await redis.del(
      `octadash:hb:${id}`,
      `octadash:hbf:${id}`,
      `octadash:hbo:${id}`,
      `octadash:hbfo:${id}`,
    )
  })

  it('forwards live events to the listeners of each organization', async () => {
    const subscriber = createValkey(url ?? '', { name: 'octadash-test-live' })
    const hub = new ValkeyLiveHub(subscriber)
    const publisher = new ValkeyLivePublisher(redis, () => 42)
    const org = crypto.randomUUID()
    const seen: LiveEvent[] = []
    const stop = await hub.subscribe([org, null], (event) => seen.push(event))
    await publisher.publish(org, 'incidents')
    await publisher.publish(crypto.randomUUID(), 'incidents')
    await publisher.publish(null, 'watcher')
    await new Promise((r) => setTimeout(r, 100))
    expect(seen).toEqual([
      { topic: 'incidents', at: 42 },
      { topic: 'watcher', at: 42 },
    ])
    stop()
    await publisher.publish(org, 'monitors')
    await new Promise((r) => setTimeout(r, 100))
    expect(seen).toHaveLength(2)
    subscriber.disconnect()
  })
})
