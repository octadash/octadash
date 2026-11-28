/**
 * The emergency strip on top of every screen, and its "See all" list, as
 * closed in the Emergencies canvas. Pure: the server builds the items, the
 * browser keeps the times current and decides what the strip says.
 */

export type StripKind =
  | 'monitor_down'
  | 'heartbeat_missed'
  | 'cert_expiring'
  | 'error_spike'
  | 'other'

export interface StripItem {
  id: string
  /** The emergency page. */
  href: string
  projectId: string
  product: string
  /** A signal, not an emergency: only TV mode asks for these. */
  signal?: boolean
  kind: StripKind
  /** "Acme Shop is down": the strip with one emergency. */
  title: string
  /** "Acme Shop down": one of a few names on the strip. */
  short: string
  /** "Monitor “Site”: 502 Bad Gateway". */
  detail: string
  startedAt: number
  /** When the rule's wait is over and it shows as an emergency. */
  showAt: number
  taker: { id: string; name: string; at: number } | null
  /** The address the product resolved to, for the same-server hint. */
  ip: string | null
  /** Control addresses Octadash reached (or not) when it went down. */
  controls: { target: string; ok: boolean }[]
}

export interface StripResolved {
  id: string
  href: string
  /** "Acme Shop is back" or "Acme Shop: closed by Ana". */
  title: string
  lastedMs: number
  /** Who was on it, when someone was. */
  taker: string | null
  resolvedAt: number
}

export interface StripData {
  /** The viewer. */
  me: string
  /** The server's clock when this was built, so browsers with a wrong clock agree. */
  serverNow: number
  items: StripItem[]
  resolved: StripResolved[]
  /** Octadash cannot reach its outside watcher. */
  watcherFailing: boolean
}

/** How long the strip stays green after an emergency ends. */
export const RESOLVED_SHOW_MS = 10_000
/** Up to this many, the strip names each one; above, it counts. */
export const NAMES_UP_TO = 3
/** Emergencies that started this close are "within N min of each other". */
export const TOGETHER_MS = 10 * 60_000
/** The "See all" list shows this many before "Show all". */
export const LIST_FIRST = 8

/** What shows now: the rule's wait is over. */
export function visibleItems(items: StripItem[], now: number) {
  return items.filter((item) => item.showAt <= now)
}

/** Recently ended, newest first, still within its green moment. */
export function visibleResolved(resolved: StripResolved[], now: number) {
  return resolved
    .filter((r) => now - r.resolvedAt < RESOLVED_SHOW_MS && now >= r.resolvedAt - 1000)
    .sort((a, b) => b.resolvedAt - a.resolvedAt)
}

export type StripSort = 'nobody' | 'oldest' | 'newest'

/** "Nobody on it first, then the oldest" is the default. */
export function sortItems(items: StripItem[], sort: StripSort = 'nobody') {
  return [...items].sort((a, b) => {
    if (sort === 'newest') return b.startedAt - a.startedAt
    if (sort === 'nobody' && !a.taker !== !b.taker) return a.taker ? 1 : -1
    return a.startedAt - b.startedAt
  })
}

export type StripFilter = 'all' | 'nobody' | 'mine'

export function filterItems(items: StripItem[], filter: StripFilter, me: string) {
  if (filter === 'nobody') return items.filter((i) => !i.taker)
  if (filter === 'mine') return items.filter((i) => i.taker?.id === me)
  return items
}

/** Who is on what, for the badge on the right of the strip. */
export type TakerLine =
  | { kind: 'nobody' }
  | { kind: 'you'; count: number }
  | { kind: 'one'; name: string; count: number }
  | { kind: 'several'; count: number }

export function takerLine(items: StripItem[], me: string): TakerLine {
  const taken = items.filter((i) => i.taker)
  if (taken.length === 0) return { kind: 'nobody' }
  const people = new Set(taken.map((i) => i.taker?.id))
  if (people.size > 1) return { kind: 'several', count: taken.length }
  const taker = taken[0]?.taker as NonNullable<StripItem['taker']>
  return taker.id === me
    ? { kind: 'you', count: taken.length }
    : { kind: 'one', name: taker.name, count: taken.length }
}

/** The biggest set of products down on one address: a hint, never a merge. */
export interface SharedServer {
  ip: string
  ids: string[]
  products: number
}

export function sharedServer(items: StripItem[]): SharedServer | null {
  const byIp = new Map<string, StripItem[]>()
  for (const item of items) {
    if (item.kind !== 'monitor_down' || !item.ip) continue
    byIp.set(item.ip, [...(byIp.get(item.ip) ?? []), item])
  }
  let best: SharedServer | null = null
  for (const [ip, list] of byIp) {
    const products = new Set(list.map((i) => i.projectId)).size
    if (products < 2) continue
    if (!best || list.length > best.ids.length) {
      best = { ip, ids: list.map((i) => i.id), products }
    }
  }
  return best
}

export interface StripSummary {
  count: number
  products: number
  /** Minutes between the first and the last start, when they started together. */
  togetherMinutes: number | null
  shared: SharedServer | null
  oldestAt: number
}

export function stripSummary(items: StripItem[]): StripSummary {
  const starts = items.map((i) => i.startedAt)
  const first = Math.min(...starts)
  const span = Math.max(...starts) - first
  return {
    count: items.length,
    products: new Set(items.map((i) => i.projectId)).size,
    togetherMinutes:
      items.length > 1 && span <= TOGETHER_MS ? Math.max(1, Math.ceil(span / 60_000)) : null,
    shared: sharedServer(items),
    oldestAt: first,
  }
}

/**
 * What Octadash saw from here when these went down: control addresses that
 * answered mean this install's network is fine.
 */
export function controlsSeen(items: StripItem[]) {
  const reached = new Set<string>()
  const failed = new Set<string>()
  for (const item of items) {
    for (const c of item.controls) (c.ok ? reached : failed).add(c.target)
  }
  for (const target of reached) failed.delete(target)
  return { reached: [...reached], failed: [...failed] }
}
