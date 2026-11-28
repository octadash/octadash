/** A product's retention is read again after this long; a new choice reaches new rows within it. */
const RETENTION_TTL_MS = 60_000

/**
 * Days each product keeps an area's rows, read from Postgres at most once a
 * minute per product. Rows carry it into ClickHouse, where the table's TTL
 * reads it.
 */
export function cachedRetention(
  load: (projectIds: string[]) => Promise<Map<string, number>>,
  fallback: number,
  now: () => number = Date.now,
) {
  const cache = new Map<string, { days: number; expires: number }>()
  return async (projectIds: string[]): Promise<Map<string, number>> => {
    const at = now()
    const ids = [...new Set(projectIds)]
    const stale = ids.filter((id) => (cache.get(id)?.expires ?? 0) <= at)
    if (stale.length > 0) {
      const fresh = await load(stale)
      for (const id of stale) {
        cache.set(id, { days: fresh.get(id) ?? fallback, expires: at + RETENTION_TTL_MS })
      }
    }
    return new Map(ids.map((id) => [id, cache.get(id)?.days ?? fallback]))
  }
}
