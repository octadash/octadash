import {
  createValkey,
  type LivePublisher,
  type LiveScope,
  type LiveTopic,
  type StorageStatusStore,
  ValkeyLiveHub,
  ValkeyLivePublisher,
  ValkeyStorageStatus,
} from '@octadash/queue'
import { services } from './context'

interface Live {
  hub: ValkeyLiveHub
  publisher: LivePublisher
  /** What the worker last saw of file storage. */
  storage: StorageStatusStore
}

// On globalThis so hot reload in development does not open new connections.
const store = globalThis as unknown as { __octadashLive?: Live }

/**
 * Two Valkey connections per panel process: one in subscriber mode shared by
 * every open screen, one for publishing. Opened on first use.
 */
export function live(): Live {
  if (!store.__octadashLive) {
    const { env } = services()
    const subscriber = createValkey(env.VALKEY_URL, { name: 'octadash-web-live' })
    const publisher = createValkey(env.VALKEY_URL, { name: 'octadash-web', failFast: true })
    // ioredis reconnects by itself; without a listener an error would crash the process.
    subscriber.on('error', () => {})
    publisher.on('error', () => {})
    store.__octadashLive = {
      hub: new ValkeyLiveHub(subscriber),
      publisher: new ValkeyLivePublisher(publisher),
      storage: new ValkeyStorageStatus(publisher),
    }
  }
  return store.__octadashLive
}

/** Tells the open screens of an organization that something changed. Never fails the action. */
export async function tellLive(scope: LiveScope, topic: LiveTopic) {
  try {
    await live().publisher.publish(scope, topic)
  } catch {
    // The screens catch up on their next load.
  }
}

/** File storage as the worker last saw it; null when it has not looked yet or Valkey is away. */
export async function readStorageStatus() {
  try {
    return await live().storage.read()
  } catch {
    return null
  }
}
