import { uuidv7 } from '@octadash/core'
import type { Db } from './client'

/**
 * Product usage records (migration 0021): key events and funnels. The events
 * themselves are in ClickHouse; see clickhouse/usage.ts.
 */

/**
 * Event names that mean "someone signed up", counted as Sign-ups without any
 * setting: the standard name, the snake_case one the setup suggests, and the
 * ones other tools use.
 */
export const SIGNUP_EVENTS = [
  'signup.completed',
  'signed_up',
  'sign_up',
  'user_signed_up',
  'user.signed_up',
  'registration_completed',
]

export interface KeyEvent {
  orgId: string
  projectId: string
  event: string
}

/** The key events of some products, or of every product (all organizations) when null. */
export async function listKeyEvents(
  db: Db,
  orgId: string | null,
  projectIds: string[] | null = null,
): Promise<KeyEvent[]> {
  if (projectIds?.length === 0) return []
  let query = db.selectFrom('key_event').select(['org_id', 'project_id', 'event'])
  if (orgId) query = query.where('org_id', '=', orgId)
  if (projectIds) query = query.where('project_id', 'in', projectIds)
  const rows = await query.orderBy('event').execute()
  return rows.map((r) => ({ orgId: r.org_id, projectId: r.project_id, event: r.event }))
}

/** Marks or unmarks one event of a product as key. */
export async function setKeyEvent(
  db: Db,
  orgId: string,
  projectId: string,
  event: string,
  key: boolean,
  userId: string | null,
): Promise<void> {
  if (key) {
    await db
      .insertInto('key_event')
      .values({ org_id: orgId, project_id: projectId, event, created_by: userId })
      .onConflict((oc) => oc.doNothing())
      .execute()
  } else {
    await db
      .deleteFrom('key_event')
      .where('org_id', '=', orgId)
      .where('project_id', '=', projectId)
      .where('event', '=', event)
      .execute()
  }
}

export interface Funnel {
  id: string
  projectId: string
  name: string
  steps: string[]
  windowDays: number
}

const toFunnel = (row: {
  id: string
  project_id: string
  name: string
  steps: unknown
  window_days: number
}): Funnel => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  steps: Array.isArray(row.steps) ? row.steps.filter((s) => typeof s === 'string') : [],
  windowDays: row.window_days,
})

/** The funnels of some products, oldest first. */
export async function listFunnels(db: Db, orgId: string, projectIds: string[]): Promise<Funnel[]> {
  if (projectIds.length === 0) return []
  const rows = await db
    .selectFrom('funnel')
    .select(['id', 'project_id', 'name', 'steps', 'window_days'])
    .where('org_id', '=', orgId)
    .where('project_id', 'in', projectIds)
    .orderBy('created_at')
    .execute()
  return rows.map(toFunnel)
}

export interface FunnelInput {
  name: string
  steps: string[]
  windowDays: number
}

/** Creates a funnel, or changes it when `id` is given. Returns its id, or null when not found. */
export async function saveFunnel(
  db: Db,
  orgId: string,
  projectId: string,
  input: FunnelInput,
  userId: string | null,
  id?: string,
): Promise<string | null> {
  const values = {
    name: input.name,
    steps: JSON.stringify(input.steps),
    window_days: input.windowDays,
  }
  if (id) {
    const result = await db
      .updateTable('funnel')
      .set({ ...values, updated_at: new Date() })
      .where('id', '=', id)
      .where('org_id', '=', orgId)
      .where('project_id', '=', projectId)
      .executeTakeFirst()
    return result.numUpdatedRows > 0n ? id : null
  }
  const created = uuidv7()
  await db
    .insertInto('funnel')
    .values({ id: created, org_id: orgId, project_id: projectId, created_by: userId, ...values })
    .execute()
  return created
}

export async function deleteFunnel(db: Db, orgId: string, id: string): Promise<boolean> {
  const result = await db
    .deleteFrom('funnel')
    .where('id', '=', id)
    .where('org_id', '=', orgId)
    .executeTakeFirst()
  return result.numDeletedRows > 0n
}
