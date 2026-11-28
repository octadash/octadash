import { listOrgAreas, listOrgSources, type SourceLastData, sourcesLastData } from '@octadash/db'
import { areaSetup, SETUP_ORDER } from '@/lib/area-setup'
import type { ProductAreaSetup } from '@/views/area-start'
import { services } from './context'

/** The kind of data that says a product already sends to an area. */
const KIND = { traffic: 'pageview', usage: 'event', logs: 'log' } as const satisfies Record<
  string,
  keyof SourceLastData
>

/**
 * Where each product stands on Traffic, Product usage or Logs, quickest to
 * finish first. A product sends when any of its sources sent that kind of
 * data in the last 30 days.
 */
export async function loadAreaSetup(
  orgId: string,
  projects: { id: string; name: string; slug: string }[],
  area: keyof typeof KIND,
  now = new Date(),
): Promise<ProductAreaSetup[]> {
  const { db, clickhouse } = services()
  const ids = projects.map((p) => p.id)
  const [sources, areas, seen] = await Promise.all([
    listOrgSources(db, orgId),
    listOrgAreas(db, orgId),
    sourcesLastData(clickhouse, orgId, ids, new Date(now.getTime() - 30 * 86_400_000)).catch(
      () => null,
    ),
  ])
  return projects
    .map((p) => {
      const own = sources.filter((s) => s.project_id === p.id)
      return {
        product: { id: p.id, name: p.name, slug: p.slug },
        ...areaSetup(area, {
          sources: own,
          // Without the event store, assume it sends: no start page over real data.
          hadData: seen === null || own.some((s) => seen.get(s.id)?.[KIND[area]]),
          dismissed: areas.get(p.id)?.get(area) === 'dismissed',
        }),
      }
    })
    .sort((a, b) => SETUP_ORDER[a.state] - SETUP_ORDER[b.state])
}
