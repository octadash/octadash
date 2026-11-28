/**
 * Where a product stands on an area that sources feed (Errors, Traffic,
 * Product usage, Logs), for its empty page and the table of products: it
 * sends, it waits for the first data (a source is set for the area), it can
 * start from a source that already sends something else, it has nothing yet,
 * or the owner said it won't use the area.
 */
export type AreaSetupState = 'sending' | 'waiting' | 'canUse' | 'none' | 'dismissed'

export interface AreaSetupSource {
  id: string
  name: string
  platform: string
  areas: string[]
}

export interface AreaSetup {
  state: AreaSetupState
  /** The source to wait on (waiting) or to start from (canUse). */
  source: AreaSetupSource | null
  /**
   * canUse: every source of the product the area can start from, quickest
   * first (Site, Docs, App). A product often has several.
   */
  candidates?: AreaSetupSource[]
}

/** Order of the table of products: the quickest to finish first. */
export const SETUP_ORDER: Record<AreaSetupState, number> = {
  sending: 0,
  waiting: 1,
  canUse: 2,
  none: 3,
  dismissed: 4,
}

/**
 * Sources a product's area can start from: a page script cannot send log
 * lines, and a server process does not send page views.
 */
const CANNOT_START: Record<string, readonly string[]> = {
  logs: ['html', 'react', 'wordpress', 'gtm'],
  traffic: ['node', 'python', 'dotnet', 'go', 'java', 'ruby'],
}

export function areaSetup(
  area: string,
  input: {
    sources: AreaSetupSource[]
    /** Whether the product ever sent this area's data. */
    hadData: boolean
    dismissed: boolean
  },
): AreaSetup {
  const forArea = input.sources.find((s) => s.areas.includes(area))
  if (input.hadData) return { state: 'sending', source: forArea ?? null }
  if (forArea) return { state: 'waiting', source: forArea }
  if (input.dismissed) return { state: 'dismissed', source: null }
  // A source with the page script is the quickest start: it is already on the page.
  const excluded = CANNOT_START[area] ?? []
  const usable = input.sources.filter((s) => !excluded.includes(s.platform))
  const candidates = [
    ...usable.filter((s) => s.areas.includes('traffic')),
    ...usable.filter((s) => !s.areas.includes('traffic')),
  ]
  const [start] = candidates
  return start ? { state: 'canUse', source: start, candidates } : { state: 'none', source: null }
}
