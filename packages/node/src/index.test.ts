import { afterEach, describe, expect, it, vi } from 'vitest'
import { Octadash, parseStack } from './index'

type Sent = Record<string, unknown> & { exception: { values: { type: string; value: string }[] } }
type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> }

function fakeFetch(statuses: number[] = []) {
  const calls: Call[] = []
  const send = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      headers: init?.headers as Record<string, string>,
    })
    const status = statuses.shift() ?? 202
    if (status === 0) throw new Error('connection refused')
    return new Response('{}', { status })
  })
  return { calls, send: send as unknown as typeof fetch }
}

const client = (send: typeof fetch, key = 'pk_test') =>
  new Octadash({ key, host: 'https://ingest.example.com/', fetch: send, captureUncaught: false })

afterEach(() => {
  vi.useRealTimers()
})

describe('parseStack', () => {
  it('reads V8 frames oldest first and marks dependencies as not in the app', () => {
    const frames = parseStack(
      [
        'Error: boom',
        '    at charge (/srv/app/src/billing.js:10:5)',
        '    at /srv/app/node_modules/express/lib/router.js:20:3',
        '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
      ].join('\n'),
    )
    expect(frames.map((f) => [f.function, f.lineno, f.in_app])).toEqual([
      ['process.processTicksAndRejections', 95, false],
      ['?', 20, false],
      ['charge', 10, true],
    ])
    expect(frames[2]?.filename).toBe('app/src/billing.js')
  })
})

describe('Octadash', () => {
  it('sends events in one batch with the key', async () => {
    const { calls, send } = fakeFetch()
    const octadash = client(send)
    octadash.track('signed_up', { distinctId: 'u1', properties: { plan: 'pro' } })
    octadash.track('paid', { distinctId: 'u1' })
    await octadash.flush()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://ingest.example.com/o/v1/events')
    expect(calls[0]?.headers['x-octadash-key']).toBe('pk_test')
    const events = calls[0]?.body.events as Record<string, unknown>[]
    expect(events.map((e) => [e.event, e.distinct_id])).toEqual([
      ['signed_up', 'u1'],
      ['paid', 'u1'],
    ])
  })

  it('sends an error as a Sentry event, with its causes', async () => {
    const { calls, send } = fakeFetch()
    const octadash = new Octadash({
      key: 'pk_test',
      host: 'https://ingest.example.com',
      release: '1.2.0',
      environment: 'staging',
      fetch: send,
      captureUncaught: false,
    })
    const id = octadash.captureException(
      new Error('charge failed', { cause: new TypeError('card is null') }),
      { distinctId: 'u1', tags: { gateway: 'stripe' } },
    )
    await octadash.flush()
    expect(calls[0]?.url).toBe('https://ingest.example.com/o/v1/errors')
    expect(calls[0]?.body.key).toBe('pk_test')
    const event = (calls[0]?.body.events as Sent[] | undefined)?.[0]
    expect(event?.event_id).toBe(id)
    expect(event?.release).toBe('1.2.0')
    expect(event?.environment).toBe('staging')
    expect(event?.user).toEqual({ id: 'u1' })
    expect(event?.tags).toEqual({ gateway: 'stripe' })
    expect(event?.exception.values.map((v) => v.type)).toEqual(['TypeError', 'Error'])
  })

  it('turns a thrown string into an error', async () => {
    const { calls, send } = fakeFetch()
    const octadash = client(send)
    octadash.captureException('not an error')
    await octadash.flush()
    const event = (calls[0]?.body.events as Sent[] | undefined)?.[0]
    expect(event?.exception.values[0]?.value).toBe('not an error')
  })

  it('does nothing without a key', async () => {
    const { calls, send } = fakeFetch()
    const octadash = client(send, '')
    expect(octadash.enabled).toBe(false)
    octadash.track('signed_up')
    octadash.captureException(new Error('x'))
    await octadash.flush()
    expect(calls).toHaveLength(0)
  })

  it('tries again when the ingest is down, and gives up on a refusal', async () => {
    vi.useFakeTimers()
    const { calls, send } = fakeFetch([0, 503, 202])
    const octadash = client(send)
    octadash.track('signed_up')
    await octadash.flush()
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(calls).toHaveLength(3)

    const refused = fakeFetch([401])
    const other = client(refused.send)
    other.track('signed_up')
    await other.flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(refused.calls).toHaveLength(1)
  })

  it('keeps at most maxQueue items, dropping the oldest', async () => {
    const { calls, send } = fakeFetch()
    const octadash = new Octadash({
      key: 'pk_test',
      host: 'https://ingest.example.com',
      fetch: send,
      captureUncaught: false,
      maxQueue: 2,
    })
    for (const name of ['a', 'b', 'c']) octadash.track(name)
    await octadash.flush()
    const events = calls[0]?.body.events as { event: string }[]
    expect(events.map((e) => e.event)).toEqual(['b', 'c'])
  })
})
