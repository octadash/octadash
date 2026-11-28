import type { Db } from './client'
import type { ProjectAreaState } from './schema'

/** The areas a product can use, in menu order. The overview is built from them. */
export const AREAS = ['uptime', 'traffic', 'usage', 'errors', 'money', 'costs', 'logs'] as const
export type AreaId = (typeof AREAS)[number]

export function isArea(value: string): value is AreaId {
  return (AREAS as readonly string[]).includes(value)
}

/** The owner's decision for each area of a product. Areas without a row are not set up. */
export async function listProjectAreas(db: Db, orgId: string, projectId: string) {
  const rows = await db
    .selectFrom('project_area')
    .select(['area', 'state'])
    .where('org_id', '=', orgId)
    .where('project_id', '=', projectId)
    .execute()
  return new Map(
    rows.filter((row) => isArea(row.area)).map((row) => [row.area as AreaId, row.state]),
  )
}

/** Sets an area's state, or clears it with null (back to "not set up"). */
export async function setProjectArea(
  db: Db,
  orgId: string,
  projectId: string,
  area: AreaId,
  state: ProjectAreaState | null,
) {
  if (state === null) {
    await db
      .deleteFrom('project_area')
      .where('org_id', '=', orgId)
      .where('project_id', '=', projectId)
      .where('area', '=', area)
      .execute()
    return
  }
  // The product must belong to the organization; the insert reads it from there.
  await db
    .insertInto('project_area')
    .columns(['org_id', 'project_id', 'area', 'state'])
    .expression((eb) =>
      eb
        .selectFrom('project')
        .select(['org_id', 'id', eb.val(area).as('area'), eb.val(state).as('state')])
        .where('org_id', '=', orgId)
        .where('id', '=', projectId),
    )
    .onConflict((oc) =>
      oc.columns(['project_id', 'area']).doUpdateSet({ state, updated_at: new Date() }),
    )
    .execute()
}
