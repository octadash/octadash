/** The product a public key sends data for. */
export interface IngestScope {
  org_id: string
  project_id: string
}

export interface KeyResolver {
  resolve(publicKey: string): Promise<IngestScope | null>
}

/** Resolves a heartbeat token to its monitor id. */
export interface HeartbeatResolver {
  resolve(token: string): Promise<string | null>
}

export interface CacheOptions {
  /** How long a known value is trusted without asking Postgres again. Revoking takes up to this long. */
  ttlMs?: number
  /** How long an unknown value is remembered, so garbage does not reach Postgres every time. */
  negativeTtlMs?: number
  maxEntries?: number
  now?: () => number
}

/**
 * Wraps a Postgres lookup with an in-memory cache. A busy product costs one
 * query a minute, not one per request, and concurrent misses for the same
 * value share one query. Values that fail `format` never reach the lookup.
 */
function cachedLookup<T>(
  format: RegExp,
  lookup: (value: string) => Promise<T | null>,
  options: CacheOptions = {},
): (value: string) => Promise<T | null> {
  const ttlMs = options.ttlMs ?? 60_000
  const negativeTtlMs = options.negativeTtlMs ?? 30_000
  const maxEntries = options.maxEntries ?? 10_000
  const now = options.now ?? Date.now
  const cache = new Map<string, { found: T | null; expires: number }>()
  const inflight = new Map<string, Promise<T | null>>()

  return async (value) => {
    if (!format.test(value)) return null
    const hit = cache.get(value)
    if (hit && hit.expires > now()) return hit.found
    const pending = inflight.get(value)
    if (pending) return pending
    const promise = lookup(value)
      .then((found) => {
        if (cache.size >= maxEntries) cache.delete(cache.keys().next().value ?? '')
        cache.set(value, { found, expires: now() + (found ? ttlMs : negativeTtlMs) })
        return found
      })
      .finally(() => inflight.delete(value))
    inflight.set(value, promise)
    return promise
  }
}

export function cachedResolver(
  lookup: (publicKey: string) => Promise<IngestScope | undefined>,
  options: CacheOptions = {},
): KeyResolver {
  const resolve = cachedLookup(
    /^[0-9a-f]{32}$/,
    async (publicKey) => {
      const found = await lookup(publicKey)
      return found ? { org_id: found.org_id, project_id: found.project_id } : null
    },
    options,
  )
  return { resolve }
}

export function cachedHeartbeatResolver(
  lookup: (token: string) => Promise<{ id: string } | undefined>,
  options: CacheOptions = {},
): HeartbeatResolver {
  const resolve = cachedLookup(
    /^[A-Za-z0-9_-]{32}$/,
    async (token) => (await lookup(token))?.id ?? null,
    options,
  )
  return { resolve }
}

/** Fixed keys. For tests. */
export function staticResolver(keys: Record<string, IngestScope>): KeyResolver {
  return { resolve: async (publicKey) => keys[publicKey] ?? null }
}
