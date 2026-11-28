import { areaOfEvent, type Discarded, type EventRow, NO_SOURCE } from '@octadash/db'

/** A dismissed area is read again after this long; turning an area off takes up to this. */
const DISMISSED_TTL_MS = 60_000

export interface RouterDeps {
  loadDismissed(projectIds: string[]): Promise<Map<string, Set<string>>>
  recordDiscarded(discarded: Discarded[], at: Date): Promise<void>
  addSourceAreas(pairs: { source_id: string; area: string }[]): Promise<void>
  now(): number
}

/**
 * Decides, batch by batch, which events are stored. Events for an area the
 * product marked "I won't use this" are dropped and counted; events of a kind
 * a source had not sent before add that area to the source.
 */
export class EventRouter {
  private readonly dismissed = new Map<string, { areas: Set<string>; expires: number }>()
  /** Source and area pairs already saved by this process. */
  private readonly known = new Set<string>()

  constructor(private readonly deps: RouterDeps) {}

  async route(rows: EventRow[]): Promise<EventRow[]> {
    if (rows.length === 0) return rows
    const now = this.deps.now()
    const stale = [...new Set(rows.map((row) => row.project_id))].filter(
      (id) => (this.dismissed.get(id)?.expires ?? 0) <= now,
    )
    if (stale.length > 0) {
      const fresh = await this.deps.loadDismissed(stale)
      for (const id of stale) {
        this.dismissed.set(id, {
          areas: fresh.get(id) ?? new Set(),
          expires: now + DISMISSED_TTL_MS,
        })
      }
    }

    const kept: EventRow[] = []
    const discarded = new Map<string, Discarded>()
    const fed = new Map<string, { source_id: string; area: string }>()
    for (const row of rows) {
      const area = areaOfEvent(row.event)
      if (this.dismissed.get(row.project_id)?.areas.has(area)) {
        const key = `${row.project_id}:${area}`
        const entry = discarded.get(key) ?? { project_id: row.project_id, area, count: 0 }
        entry.count++
        discarded.set(key, entry)
        continue
      }
      kept.push(row)
      const source = row.source_id ?? NO_SOURCE
      const pair = `${source}:${area}`
      if (source !== NO_SOURCE && !this.known.has(pair)) {
        fed.set(pair, { source_id: source, area })
      }
    }

    if (discarded.size > 0) await this.deps.recordDiscarded([...discarded.values()], new Date(now))
    if (fed.size > 0) {
      await this.deps.addSourceAreas([...fed.values()])
      for (const pair of fed.keys()) this.known.add(pair)
    }
    return kept
  }
}
