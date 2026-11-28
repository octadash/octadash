import {
  getGroupBySlug,
  getOrganizationSettings,
  listHappenings,
  listOrgMonitors,
  listProjects,
  type TvActivity,
  tvActivity,
} from '@octadash/db'
import type { StripItem } from '@/lib/emergency-strip'
import { type ProductStatus, worstStatus } from '@/lib/monitors'
import { startOfDay } from '@/lib/traffic'
import type { TvMetric, TvSettings } from '@/lib/tv'
import { services } from './context'
import { loadStrip } from './emergency-strip'

export interface TvTile {
  id: string
  name: string
  status: ProductStatus
  /** The product's open emergency, oldest first, or its signal. */
  emergency: StripItem | null
  signal: StripItem | null
  /** On every page: something is going on. */
  pinned: boolean
  activity: TvActivity | null
  values: Partial<Record<TvMetric, number | null>>
}

export interface TvHappening {
  at: number
  kind: 'down' | 'signal' | 'back' | 'took'
  incident: string
  product: string
  name: string | null
  person: string | null
}

export interface TvData {
  /** The screen's title: "All products", a group or a product name. */
  title: string | null
  timeZone: string
  serverNow: number
  tiles: TvTile[]
  emergencies: StripItem[]
  happened: TvHappening[]
  online: number
  /** False when ClickHouse did not answer: numbers show "—". */
  complete: boolean
}

const VALUE: Record<TvMetric, (a: TvActivity) => number | null> = {
  visitorsNow: (a) => a.visitorsNow,
  pageviewsToday: (a) => a.pageviewsToday,
  eventsToday: (a) => a.eventsToday,
  responseMs: (a) => a.responseMs,
}

/**
 * Everything one TV screen shows. Emergencies of every product reach the
 * strip, even of products not on this screen, as on the panel.
 */
export async function loadTv(
  orgId: string,
  settings: TvSettings,
  now = new Date(),
): Promise<TvData | null> {
  const { db, clickhouse } = services()
  const [org, projects, monitors] = await Promise.all([
    getOrganizationSettings(db, orgId),
    listProjects(db, orgId),
    listOrgMonitors(db, orgId),
  ])
  let shown = projects
  let title: string | null = null
  if (settings.scope.startsWith('g:')) {
    const group = await getGroupBySlug(db, orgId, settings.scope.slice(2))
    if (!group) return null
    shown = projects.filter((p) => group.project_ids.includes(p.id))
    title = group.name
  } else if (settings.scope.startsWith('p:')) {
    shown = projects.filter((p) => p.slug === settings.scope.slice(2))
    if (shown.length === 0) return null
    title = shown[0]?.name ?? null
  }
  const ids = shown.map((p) => p.id)

  let complete = true
  const [strip, activity, happened] = await Promise.all([
    loadStrip(orgId, '', false, now, true),
    tvActivity(clickhouse, orgId, ids, startOfDay(now, org.timeZone), now).catch(() => {
      complete = false
      return new Map<string, TvActivity>()
    }),
    listHappenings(db, orgId, new Date(now.getTime() - 86_400_000), 8, now),
  ])
  const live = strip.items.filter((item) => item.showAt <= now.getTime())
  const emergencies = live.filter((item) => !item.signal)
  const signals = live.filter((item) => item.signal)

  const tiles: TvTile[] = shown.map((product) => {
    const own = monitors.filter((m) => m.project_id === product.id && !m.paused)
    const emergency =
      emergencies
        .filter((item) => item.projectId === product.id)
        .sort((a, b) => a.startedAt - b.startedAt)[0] ?? null
    const signal = signals.find((item) => item.projectId === product.id) ?? null
    const a = activity.get(product.id) ?? null
    return {
      id: product.id,
      name: product.name,
      status: worstStatus(own.map((m) => m.status)),
      emergency,
      signal,
      pinned: Boolean(emergency || signal),
      activity: a,
      values: Object.fromEntries(
        settings.metrics.map((m) => [m, a ? VALUE[m](a) : null]),
      ) as TvTile['values'],
    }
  })
  // Down products first, then signals, then the busiest.
  tiles.sort(
    (a, b) =>
      Number(Boolean(b.emergency)) - Number(Boolean(a.emergency)) ||
      Number(Boolean(b.signal)) - Number(Boolean(a.signal)) ||
      (b.activity?.visitorsNow ?? -1) - (a.activity?.visitorsNow ?? -1) ||
      a.name.localeCompare(b.name),
  )

  return {
    title,
    timeZone: org.timeZone,
    serverNow: now.getTime(),
    tiles,
    emergencies,
    happened: happened
      .filter((h) => ids.includes(h.projectId))
      .map((h) => ({
        at: h.at.getTime(),
        kind: h.kind,
        incident: h.incident,
        product: h.product,
        name: h.name,
        person: h.person,
      })),
    online: [...activity.values()].reduce((sum, a) => sum + a.visitorsNow, 0),
    complete,
  }
}
