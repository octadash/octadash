/**
 * @octadash/node: send errors and events from a Node.js server to Octadash.
 *
 * One file and no dependencies, so it runs anywhere Node 18+ runs (fetch is
 * built in). Calls never throw and never wait: what is sent is queued, sent in
 * batches, and tried again when the ingest is down for a moment (a redeploy).
 *
 *   import { Octadash } from '@octadash/node'
 *   const octadash = new Octadash({ key: process.env.OCTADASH_KEY, host: 'https://ingest.example.com' })
 *   octadash.track('signed_up', { distinctId: user.id, properties: { plan: 'pro' } })
 *   octadash.captureException(err, { distinctId: user.id })
 */

export interface OctadashOptions {
  /** The source's key, from Set up in the panel. Empty turns the client off. */
  key: string | undefined
  /** The ingest's public address, such as https://ingest.example.com. */
  host: string
  /** The version running, to see which deploy an error started in. */
  release?: string
  /** "production" by default (NODE_ENV when set). */
  environment?: string
  /** Report uncaught exceptions and unhandled rejections, then exit as Node would. true by default. */
  captureUncaught?: boolean
  /** How long events wait to be sent together, in milliseconds. 2000 by default. */
  flushInterval?: number
  /** Most events kept while the ingest does not answer; the oldest go first. 1000 by default. */
  maxQueue?: number
  /** For tests and other runtimes. */
  fetch?: typeof fetch
}

export interface TrackOptions {
  /** Who did it: your user id. Octadash keeps only a hash of it. */
  distinctId?: string
  properties?: Record<string, unknown>
  timestamp?: Date
}

export interface CaptureOptions {
  /** Your user id, to know how many people an error hit. */
  distinctId?: string
  tags?: Record<string, string>
  extra?: Record<string, unknown>
  /** false for an error you caught and handled. true by default (it reached you). */
  handled?: boolean
  level?: 'fatal' | 'error' | 'warning' | 'info'
}

interface Frame {
  function: string
  filename: string
  abs_path: string
  lineno: number
  colno: number
  in_app: boolean
}

type Item = { kind: 'event' | 'error'; body: Record<string, unknown>; tries: number }

const BATCH = 100
const ERRORS_PER_REQUEST = 50
const MAX_TRIES = 4
const TIMEOUT_MS = 10_000

/** Frames of a V8 stack, oldest first, as Sentry and Octadash read them. */
export function parseStack(stack: string | undefined): Frame[] {
  const frames: Frame[] = []
  for (const line of String(stack ?? '').split('\n')) {
    const m = /^\s*at (?:(.+?) \()?(?:file:\/\/)?(.+?):(\d+):(\d+)\)?$/.exec(line)
    if (!m) continue
    const path = m[2] ?? ''
    frames.unshift({
      function: m[1] ?? '?',
      filename: path.split(/[\\/]/).slice(-3).join('/'),
      abs_path: path,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app:
        !path.startsWith('node:') &&
        !path.includes('node_modules') &&
        !path.startsWith('internal/'),
    })
  }
  return frames.slice(-100)
}

function asError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string') return new Error(value)
  try {
    return new Error(JSON.stringify(value))
  } catch {
    return new Error(String(value))
  }
}

/** The chain of causes, outermost last, as Sentry lists exceptions. */
function exceptions(error: Error, handled: boolean) {
  const chain: Error[] = []
  let current: unknown = error
  while (current instanceof Error && chain.length < 5 && !chain.includes(current)) {
    chain.push(current)
    current = current.cause
  }
  return chain.reverse().map((e) => ({
    type: e.name || 'Error',
    value: e.message,
    mechanism: { type: handled ? 'generic' : 'onuncaughtexception', handled },
    stacktrace: { frames: parseStack(e.stack) },
  }))
}

export class Octadash {
  private readonly key: string
  private readonly host: string
  private readonly send: typeof fetch
  private readonly queue: Item[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private sending: Promise<void> | null = null
  private readonly flushInterval: number
  private readonly maxQueue: number
  private readonly release?: string
  private readonly environment: string

  constructor(options: OctadashOptions) {
    this.key = options.key?.trim() ?? ''
    this.host = options.host.replace(/\/+$/, '')
    this.send = options.fetch ?? fetch
    this.flushInterval = options.flushInterval ?? 2_000
    this.maxQueue = options.maxQueue ?? 1_000
    this.release = options.release
    this.environment = options.environment ?? process.env.NODE_ENV ?? 'production'
    if (this.enabled && options.captureUncaught !== false) this.captureUncaught()
  }

  /** False without a key: every call is then a no-op, so local runs send nothing. */
  get enabled(): boolean {
    return this.key !== ''
  }

  /** Something a person did, for Product usage. */
  track(event: string, options: TrackOptions = {}): void {
    if (!this.enabled || !event) return
    this.push('event', {
      event,
      distinct_id: options.distinctId,
      properties: options.properties,
      timestamp: (options.timestamp ?? new Date()).toISOString(),
    })
  }

  /** An error for Errors. Returns its event id. */
  captureException(error: unknown, options: CaptureOptions = {}): string {
    const id = crypto.randomUUID().replaceAll('-', '')
    if (!this.enabled) return id
    const err = asError(error)
    this.push('error', {
      event_id: id,
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: options.level ?? 'error',
      release: this.release,
      environment: this.environment,
      server_name: process.env.HOSTNAME,
      sdk: { name: 'octadash.node', version: '0.1.0' },
      user: options.distinctId ? { id: options.distinctId } : undefined,
      tags: options.tags,
      extra: options.extra,
      exception: { values: exceptions(err, options.handled ?? true) },
    })
    return id
  }

  /** Sends what is queued. Await it before a short script ends. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    while (this.sending) await this.sending
    if (this.queue.length === 0) return
    this.sending = this.drain().finally(() => {
      this.sending = null
    })
    await this.sending
  }

  /** Sends what is left, waiting at most `timeoutMs`. */
  async shutdown(timeoutMs = 5_000): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      this.flush(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      }),
    ])
    clearTimeout(timer)
  }

  private push(kind: Item['kind'], body: Record<string, unknown>) {
    this.queue.push({ kind, body, tries: 0 })
    if (this.queue.length > this.maxQueue) this.queue.splice(0, this.queue.length - this.maxQueue)
    // Errors go soon: the process may be about to end.
    this.schedule(kind === 'error' ? 100 : this.flushInterval)
  }

  private schedule(ms: number) {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, ms)
    this.timer.unref?.()
  }

  private async drain() {
    const retry: Item[] = []
    while (this.queue.length > 0) {
      const events = this.take('event', BATCH)
      const errors = this.take('error', ERRORS_PER_REQUEST)
      const [eventsOk, errorsOk] = await Promise.all([
        events.length > 0 ? this.post('/o/v1/events', { events: events.map((i) => i.body) }) : true,
        errors.length > 0
          ? this.post('/o/v1/errors', { key: this.key, events: errors.map((i) => i.body) })
          : true,
      ])
      if (!eventsOk) retry.push(...events)
      if (!errorsOk) retry.push(...errors)
    }
    // A redeploy takes the ingest down for seconds: try again a few times, later.
    const again = retry.filter((item) => ++item.tries < MAX_TRIES)
    if (again.length > 0) {
      this.queue.unshift(...again)
      const tries = Math.max(...again.map((i) => i.tries))
      this.schedule(1_000 * 2 ** tries)
    }
  }

  private take(kind: Item['kind'], max: number): Item[] {
    const taken: Item[] = []
    for (let i = 0; i < this.queue.length && taken.length < max; ) {
      const item = this.queue[i]
      if (item?.kind === kind) {
        taken.push(item)
        this.queue.splice(i, 1)
      } else i++
    }
    return taken
  }

  /** true when done with the batch: sent, or refused for good (a bad key, a bad body). */
  private async post(path: string, body: unknown): Promise<boolean> {
    try {
      const response = await this.send(`${this.host}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-octadash-key': this.key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      return !(response.status === 429 || response.status >= 500)
    } catch {
      return false
    }
  }

  private captureUncaught() {
    const crash = (error: unknown) => {
      // Node prints the error and exits with 1 when nothing listens; keep that.
      console.error(error)
      this.captureException(error, { handled: false, level: 'fatal' })
      void this.shutdown(2_000).finally(() => process.exit(1))
    }
    process.on('uncaughtException', crash)
    process.on('unhandledRejection', crash)
    process.on('beforeExit', () => {
      void this.flush()
    })
  }
}
