import { DEFAULT_LOG_RETENTION_DAYS, LOG_RETENTION_CHOICES } from './clickhouse/logs'
import type { Db } from './client'

/**
 * How long each area keeps a product's data, in days. Each row in ClickHouse
 * keeps the retention its product had when it arrived, and the table's TTL
 * reads it, so a longer choice applies to what arrives next and a shorter one
 * also deletes what is now too old. Areas join this list as their retention
 * becomes a setting; null in `project_area.retention_days` is the default.
 * A name that is not an area (`events`) is a table several areas share; the
 * area lists leave it out.
 */
export const AREA_RETENTION = {
  /**
   * The `events` table, which Traffic and Product usage both read: one choice
   * for both, kept under this name rather than either area's. In days, shown
   * as months: 3, 6, 13 (a year and the same month before it) and 25.
   */
  events: { defaultDays: 395, choices: [90, 180, 395, 760] },
  errors: { defaultDays: 90, choices: [30, 90, 180, 365] },
  logs: { defaultDays: DEFAULT_LOG_RETENTION_DAYS, choices: LOG_RETENTION_CHOICES },
} as const satisfies Record<string, { defaultDays: number; choices: readonly number[] }>

export type RetentionArea = keyof typeof AREA_RETENTION
export const RETENTION_AREAS = Object.keys(AREA_RETENTION) as RetentionArea[]

export function isRetentionArea(value: string): value is RetentionArea {
  return value in AREA_RETENTION
}

export function isRetentionChoice(area: RetentionArea, days: number): boolean {
  return (AREA_RETENTION[area].choices as readonly number[]).includes(days)
}

/** Days each product keeps the area's data; products not listed keep the default. */
export async function areaRetention(
  db: Db,
  area: RetentionArea,
  projectIds: string[],
): Promise<Map<string, number>> {
  const out = new Map(projectIds.map((id) => [id, AREA_RETENTION[area].defaultDays as number]))
  if (projectIds.length === 0) return out
  const rows = await db
    .selectFrom('project_area')
    .select(['project_id', 'retention_days'])
    .where('area', '=', area)
    .where('project_id', 'in', projectIds)
    .where('retention_days', 'is not', null)
    .execute()
  for (const row of rows) if (row.retention_days) out.set(row.project_id, row.retention_days)
  return out
}

/**
 * Sets how long a product keeps the area's data, leaving the area's state as
 * it is (an area with no record yet is recorded as set up: it has data to
 * keep). Returns the days it had before, or null when the product is not the
 * organization's, so a shorter choice can delete what is now too old.
 */
export async function setAreaRetention(
  db: Db,
  orgId: string,
  projectId: string,
  area: RetentionArea,
  days: number,
): Promise<number | null> {
  const before = (await areaRetention(db, area, [projectId])).get(projectId) ?? null
  const inserted = await db
    .insertInto('project_area')
    .columns(['org_id', 'project_id', 'area', 'state', 'retention_days'])
    .expression((eb) =>
      eb
        .selectFrom('project')
        .select([
          'org_id',
          'id',
          eb.val(area).as('area'),
          eb.val('set_up').as('state'),
          eb.val(days).as('retention_days'),
        ])
        .where('org_id', '=', orgId)
        .where('id', '=', projectId),
    )
    .onConflict((oc) =>
      oc
        .columns(['project_id', 'area'])
        .doUpdateSet({ retention_days: days, updated_at: new Date() }),
    )
    .executeTakeFirst()
  return Number(inserted.numInsertedOrUpdatedRows ?? 0) > 0 ? before : null
}
