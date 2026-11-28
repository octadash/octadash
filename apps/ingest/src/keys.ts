/** The product a public key sends data for. */
export interface IngestScope {
  org_id: string
  project_id: string
}

export interface KeyResolver {
  resolve(publicKey: string): Promise<IngestScope | null>
}

export interface CachedResolverOptions {
  /** How long a known key is trusted without asking Postgres again. Revoking takes up to this long. */
  ttlMs?: number
  /** How long an unknown key is remembered, so garbage keys do not reach Postgres every time. */
  negativeTtlMs?: number
  maxEntries?: number
  now?: () => number
}

const KEY_FORMAT = /^[0-9a-f]{32}$/

/**
 * Wraps a Postgres lookup with an in-memory cache. A busy product costs one
 * query a minute, not one per request, and concurrent misses for the same key
 * share one query.
 */
export function cachedResolver(
  lookup: (publicKey: string) => Promise<IngestScope | undefined>,
  options: CachedResolverOptions = {},
): KeyResolver {
  const ttlMs = options.ttlMs ?? 60_000
  const negativeTtlMs = options.negativeTtlMs ?? 30_000
  const maxEntries = options.maxEntries ?? 10_000
  const now = options.now ?? Date.now
  const cache = new Map<string, { scope: IngestScope | null; expires: number }>()
  const inflight = new Map<string, Promise<IngestScope | null>>()

  return {
    async resolve(publicKey) {
      if (!KEY_FORMAT.test(publicKey)) return null
      const hit = cache.get(publicKey)
      if (hit && hit.expires > now()) return hit.scope
      const pending = inflight.get(publicKey)
      if (pending) return pending
      const promise = lookup(publicKey)
        .then((found) => {
          const scope = found ? { org_id: found.org_id, project_id: found.project_id } : null
          if (cache.size >= maxEntries) cache.delete(cache.keys().next().value ?? '')
          cache.set(publicKey, { scope, expires: now() + (scope ? ttlMs : negativeTtlMs) })
          return scope
        })
        .finally(() => inflight.delete(publicKey))
      inflight.set(publicKey, promise)
      return promise
    },
  }
}

/** Fixed keys. For tests. */
export function staticResolver(keys: Record<string, IngestScope>): KeyResolver {
  return { resolve: async (publicKey) => keys[publicKey] ?? null }
}
