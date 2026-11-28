import { uuidv7 } from '@octadash/core'
import { DEFAULT_LOG_RETENTION_DAYS } from './clickhouse/logs'
import type { Db } from './client'

/**
 * Logs records (migration 0022): how long each product keeps its lines and
 * the saved searches. The lines are in ClickHouse; see clickhouse/logs.ts.
 */

/** Days each product keeps its log lines; products not listed keep the default. */
export async function logRetention(db: Db, projectIds: string[]): Promise<Map<string, number>> {
  const out = new Map(projectIds.map((id) => [id, DEFAULT_LOG_RETENTION_DAYS]))
  if (projectIds.length === 0) return out
  const rows = await db
    .selectFrom('project_area')
    .select(['project_id', 'retention_days'])
    .where('area', '=', 'logs')
    .where('project_id', 'in', projectIds)
    .where('retention_days', 'is not', null)
    .execute()
  for (const row of rows) if (row.retention_days) out.set(row.project_id, row.retention_days)
  return out
}

/**
 * Sets how long a product keeps its lines; choosing it sets Logs up. Returns
 * the days it had before, so a shorter choice can delete what is now too old.
 */
export async function setLogRetention(
  db: Db,
  orgId: string,
  projectId: string,
  days: number,
): Promise<number | null> {
  const before = (await logRetention(db, [projectId])).get(projectId) ?? null
  const inserted = await db
    .insertInto('project_area')
    .columns(['org_id', 'project_id', 'area', 'state', 'retention_days'])
    .expression((eb) =>
      eb
        .selectFrom('project')
        .select([
          'org_id',
          'id',
          eb.val('logs').as('area'),
          eb.val('set_up').as('state'),
          eb.val(days).as('retention_days'),
        ])
        .where('org_id', '=', orgId)
        .where('id', '=', projectId),
    )
    .onConflict((oc) =>
      oc
        .columns(['project_id', 'area'])
        .doUpdateSet({ state: 'set_up', retention_days: days, updated_at: new Date() }),
    )
    .executeTakeFirst()
  return Number(inserted.numInsertedOrUpdatedRows ?? 0) > 0 ? before : null
}

export interface LogSearch {
  id: string
  orgId: string
  name: string
  query: string
  alert: boolean
  alertSince: Date | null
}

const toSearch = (row: {
  id: string
  org_id: string
  name: string
  query: string
  alert: boolean
  alert_since: Date | null
}): LogSearch => ({
  id: row.id,
  orgId: row.org_id,
  name: row.name,
  query: row.query,
  alert: row.alert,
  alertSince: row.alert_since,
})

/** An organization's saved searches by name, or every one with an alert (all organizations) when null. */
export async function listLogSearches(db: Db, orgId: string | null): Promise<LogSearch[]> {
  let query = db
    .selectFrom('log_search')
    .select(['id', 'org_id', 'name', 'query', 'alert', 'alert_since'])
  query = orgId ? query.where('org_id', '=', orgId) : query.where('alert', '=', true)
  const rows = await query.orderBy('name').execute()
  return rows.map(toSearch)
}

/** Creates or updates a saved search. Turning the alert on starts it from now. */
export async function saveLogSearch(
  db: Db,
  orgId: string,
  input: { name: string; query: string; alert: boolean },
  userId: string | null,
  id?: string,
  at = new Date(),
): Promise<string | null> {
  if (id) {
    const current = await db
      .selectFrom('log_search')
      .select(['alert', 'alert_since'])
      .where('org_id', '=', orgId)
      .where('id', '=', id)
      .executeTakeFirst()
    if (!current) return null
    await db
      .updateTable('log_search')
      .set({
        name: input.name,
        query: input.query,
        alert: input.alert,
        alert_since: input.alert ? (current.alert ? current.alert_since : at) : null,
        updated_at: at,
      })
      .where('org_id', '=', orgId)
      .where('id', '=', id)
      .execute()
    return id
  }
  const newId = uuidv7()
  await db
    .insertInto('log_search')
    .values({
      id: newId,
      org_id: orgId,
      name: input.name,
      query: input.query,
      alert: input.alert,
      alert_since: input.alert ? at : null,
      created_by: userId,
    })
    .execute()
  return newId
}

export async function deleteLogSearch(db: Db, orgId: string, id: string) {
  await db.deleteFrom('log_search').where('org_id', '=', orgId).where('id', '=', id).execute()
}
