import { sql } from 'kysely'
import type { AreaId } from './areas'
import type { Db } from './client'
import { withArea } from './sources'

/**
 * Where incoming data goes. The area comes from the kind of data, never from
 * the key: one browser script sends page views (Traffic) and product events
 * (Product usage) with the same source key.
 */

/** Event names the browser script sends for page views. Everything else is a product event. */
const TRAFFIC_EVENTS = new Set(['$pageview', '$pageleave'])

export function areaOfEvent(event: string): AreaId {
  return TRAFFIC_EVENTS.has(event) ? 'traffic' : 'usage'
}

/** The areas each product marked "I won't use this". */
export async function listDismissedAreas(db: Db, projectIds: string[]) {
  const dismissed = new Map<string, Set<string>>()
  for (const id of projectIds) dismissed.set(id, new Set())
  if (projectIds.length === 0) return dismissed
  const rows = await db
    .selectFrom('project_area')
    .select(['project_id', 'area'])
    .where('project_id', 'in', projectIds)
    .where('state', '=', 'dismissed')
    .execute()
  for (const row of rows) dismissed.get(row.project_id)?.add(row.area)
  return dismissed
}

export interface Discarded {
  project_id: string
  area: string
  count: number
}

/** Counts data not stored because its area is dismissed. */
export async function recordDiscarded(db: Db, discarded: Discarded[], at: Date) {
  for (const { project_id, area, count } of discarded) {
    if (count <= 0) continue
    await db
      .updateTable('project_area')
      .set({
        discarded_events: sql<number>`discarded_events + ${count}`,
        discarded_at: at,
      })
      .where('project_id', '=', project_id)
      .where('area', '=', area)
      .where('state', '=', 'dismissed')
      .execute()
  }
}

/**
 * Data of a kind arrived from a source: the source now feeds that area too, so
 * the area's setup lists it without anyone adding it.
 */
export async function addSourceAreas(db: Db, pairs: { source_id: string; area: string }[]) {
  for (const { source_id, area } of pairs) {
    await db
      .updateTable('source')
      .set({
        areas: withArea(area),
        updated_at: new Date(),
      })
      .where('id', '=', source_id)
      .where(sql<boolean>`not (${area} = any(areas))`)
      .execute()
  }
}
