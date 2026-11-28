/**
 * TV mode, as closed in the TV canvas: one tile per product, up to three
 * numbers each, pages that turn every 20 seconds with emergencies pinned.
 */

/** The numbers a tile can show. Areas not built yet join as their engines land. */
export const TV_METRICS = ['visitorsNow', 'pageviewsToday', 'eventsToday', 'responseMs'] as const
export type TvMetric = (typeof TV_METRICS)[number]

export const TV_PER_PAGE = [6, 9, 12] as const
export const TV_PAGE_MS = 20_000
export const TV_MAX_METRICS = 3

export interface TvSettings {
  /** "all", "g:<group slug>" or "p:<product slug>". */
  scope: string
  metrics: TvMetric[]
  perPage: number
  sound: boolean
}

export const TV_DEFAULTS: TvSettings = {
  scope: 'all',
  metrics: ['visitorsNow', 'pageviewsToday', 'responseMs'],
  perPage: 9,
  sound: false,
}

function isMetric(value: string): value is TvMetric {
  return (TV_METRICS as readonly string[]).includes(value)
}

/** Settings from the address or a stored link; anything odd falls back to the defaults. */
export function parseTvSettings(input: {
  scope?: unknown
  metrics?: unknown
  m?: unknown
  perPage?: unknown
  per?: unknown
  sound?: unknown
}): TvSettings {
  const scope =
    typeof input.scope === 'string' && /^(all|[gp]:[a-z0-9-]{1,80})$/.test(input.scope)
      ? input.scope
      : TV_DEFAULTS.scope
  const raw = input.metrics ?? input.m
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  const metrics = [...new Set(list.filter((v): v is string => typeof v === 'string'))]
    .filter(isMetric)
    .slice(0, TV_MAX_METRICS)
  const per = Number(input.perPage ?? input.per)
  return {
    scope,
    metrics: metrics.length > 0 ? metrics : TV_DEFAULTS.metrics,
    perPage: (TV_PER_PAGE as readonly number[]).includes(per) ? per : TV_DEFAULTS.perPage,
    sound: input.sound === true || input.sound === '1',
  }
}

/** The address of TV mode for a signed-in screen. */
export function tvHref(settings: TvSettings) {
  const params = new URLSearchParams({
    scope: settings.scope,
    m: settings.metrics.join(','),
    per: String(settings.perPage),
  })
  if (settings.sound) params.set('sound', '1')
  return `/tv?${params}`
}

/**
 * The pages of tiles: products with an emergency or a signal stay on every
 * page, first; the others fill the rest, in order.
 */
export function tvPages<T extends { pinned: boolean }>(tiles: T[], perPage: number): T[][] {
  const pinned = tiles.filter((t) => t.pinned)
  const rest = tiles.filter((t) => !t.pinned)
  const room = Math.max(perPage - pinned.length, 1)
  if (rest.length === 0) return [pinned]
  const pages: T[][] = []
  for (let i = 0; i < rest.length; i += room) pages.push([...pinned, ...rest.slice(i, i + room)])
  return pages
}
