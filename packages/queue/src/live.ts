import type { Redis } from 'ioredis'

/**
 * Live updates. Whoever changes something the panel shows (the worker opening
 * an incident, someone taking it in the panel) publishes a small event on
 * Valkey; every web process forwards it to the open screens of that
 * organization over SSE, and the screens reload their data. The event says
 * what changed, never the data itself, so a screen never shows something its
 * viewer may not see.
 *
 * One channel per organization plus one for the whole install (the outside
 * watcher). The same events will drive TV mode.
 */
const PREFIX = 'octadash:live:'

export type LiveTopic = 'incidents' | 'monitors' | 'watcher' | 'errors'

export interface LiveEvent {
  topic: LiveTopic
  /** Milliseconds since the epoch, when it changed. */
  at: number
}

/** `null` is the install itself: everyone signed in. */
export type LiveScope = string | null

export function liveChannel(scope: LiveScope): string {
  return scope === null ? `${PREFIX}instance` : `${PREFIX}org:${scope}`
}

export interface LivePublisher {
  publish(scope: LiveScope, topic: LiveTopic): Promise<void>
}

export type LiveListener = (event: LiveEvent) => void

export interface LiveSubscriber {
  /** Returns the function that stops listening. */
  subscribe(scopes: LiveScope[], listener: LiveListener): Promise<() => void>
}

export class ValkeyLivePublisher implements LivePublisher {
  constructor(
    private readonly redis: Redis,
    private readonly now: () => number = Date.now,
  ) {}

  async publish(scope: LiveScope, topic: LiveTopic) {
    const event: LiveEvent = { topic, at: this.now() }
    await this.redis.publish(liveChannel(scope), JSON.stringify(event))
  }
}

/**
 * One Valkey connection per process in subscriber mode, shared by every open
 * screen. A channel is subscribed while at least one screen listens to it, so
 * a thousand open tabs cost one connection and one subscription per
 * organization.
 */
export class ValkeyLiveHub implements LiveSubscriber {
  private readonly listeners = new Map<string, Set<LiveListener>>()

  constructor(private readonly redis: Redis) {
    redis.on('message', (channel: string, message: string) => {
      const event = parseEvent(message)
      if (!event) return
      for (const listener of this.listeners.get(channel) ?? []) listener(event)
    })
  }

  async subscribe(scopes: LiveScope[], listener: LiveListener) {
    const channels = [...new Set(scopes.map(liveChannel))]
    const fresh: string[] = []
    for (const channel of channels) {
      let set = this.listeners.get(channel)
      if (!set) {
        set = new Set()
        this.listeners.set(channel, set)
        fresh.push(channel)
      }
      set.add(listener)
    }
    if (fresh.length > 0) await this.redis.subscribe(...fresh)
    return () => {
      const empty: string[] = []
      for (const channel of channels) {
        const set = this.listeners.get(channel)
        if (!set) continue
        set.delete(listener)
        if (set.size === 0) {
          this.listeners.delete(channel)
          empty.push(channel)
        }
      }
      if (empty.length > 0) void this.redis.unsubscribe(...empty).catch(() => {})
    }
  }
}

/** In memory, publisher and subscriber at once. For tests and a single process. */
export class MemoryLive implements LivePublisher, LiveSubscriber {
  private readonly listeners = new Map<string, Set<LiveListener>>()
  readonly published: { scope: LiveScope; topic: LiveTopic }[] = []

  constructor(private readonly now: () => number = Date.now) {}

  async publish(scope: LiveScope, topic: LiveTopic) {
    this.published.push({ scope, topic })
    const event = { topic, at: this.now() }
    for (const listener of this.listeners.get(liveChannel(scope)) ?? []) listener(event)
  }

  async subscribe(scopes: LiveScope[], listener: LiveListener) {
    const channels = [...new Set(scopes.map(liveChannel))]
    for (const channel of channels) {
      const set = this.listeners.get(channel) ?? new Set()
      set.add(listener)
      this.listeners.set(channel, set)
    }
    return () => {
      for (const channel of channels) this.listeners.get(channel)?.delete(listener)
    }
  }
}

const TOPICS = new Set<string>(['incidents', 'monitors', 'watcher', 'errors'])

function parseEvent(message: string): LiveEvent | null {
  try {
    const value = JSON.parse(message) as Partial<LiveEvent>
    if (typeof value.topic !== 'string' || !TOPICS.has(value.topic)) return null
    return { topic: value.topic as LiveTopic, at: Number(value.at) || Date.now() }
  } catch {
    return null
  }
}
