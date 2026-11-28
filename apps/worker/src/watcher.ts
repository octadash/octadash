import type { Logger } from '@octadash/core'

/** Pings go out this often; Healthchecks.io's shortest period is one minute. */
export const WATCHER_EVERY_MS = 60_000
/** A healthy result is written at most this often; a change is written at once. */
const WRITE_EVERY_MS = 10 * 60_000

export interface WatcherDeps {
  /** The ping URL, decrypted, or null when the install has none. */
  loadUrl(): Promise<string | null>
  ping(url: string): Promise<void>
  record(status: 'ok' | 'failing', error: string | null, at: Date): Promise<void>
  now(): number
  log: Logger
}

/**
 * Tells an outside service that this Octadash is alive. When the pings stop
 * (the server, the worker or its network is down), that service alerts the
 * owner: the one failure Octadash cannot report itself.
 */
export class Watcher {
  private lastUrl: string | null = null
  private lastStatus: 'ok' | 'failing' | null = null
  private lastWriteAt = 0

  constructor(private readonly deps: WatcherDeps) {}

  async tick() {
    const url = await this.deps.loadUrl()
    if (!url) {
      this.lastUrl = null
      return
    }
    if (url !== this.lastUrl) {
      this.lastUrl = url
      this.lastStatus = null
    }
    let error: string | null = null
    try {
      await this.deps.ping(url)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
    const status = error === null ? 'ok' : 'failing'
    const now = this.deps.now()
    if (status === this.lastStatus && now - this.lastWriteAt < WRITE_EVERY_MS) return
    if (status !== this.lastStatus && status === 'failing') {
      this.deps.log.warn({ error }, 'outside watcher ping failed')
    }
    await this.deps.record(status, error, new Date(now))
    this.lastStatus = status
    this.lastWriteAt = now
  }
}

/** GET with a timeout; any 2xx counts. */
export async function pingUrl(url: string): Promise<void> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'user-agent': 'Octadash-Watcher' },
  })
  await res.body?.cancel()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export function startWatcher(watcher: Watcher, log: Logger) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      await watcher.tick()
    } catch (err) {
      log.warn({ err }, 'outside watcher tick failed')
    } finally {
      running = false
    }
  }
  const first = setTimeout(run, 5_000)
  const timer = setInterval(run, WATCHER_EVERY_MS)
  return {
    stop() {
      clearTimeout(first)
      clearInterval(timer)
    },
  }
}
