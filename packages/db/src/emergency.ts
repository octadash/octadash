import { uuidv7 } from '@octadash/core'
import { sql } from 'kysely'
import type { Db } from './client'
import type { IncidentEventKind } from './schema'

/**
 * One emergency, for its own page: the incident with its product, monitor and
 * who has it, what people wrote, which channels were told, and the last time
 * the same thing happened.
 */
export async function getIncident(db: Db, orgId: string, id: string) {
  return db
    .selectFrom('incident')
    .innerJoin('project', 'project.id', 'incident.project_id')
    .leftJoin('monitor', 'monitor.id', 'incident.monitor_id')
    .leftJoin('auth_user', (join) =>
      join.on(sql`auth_user.id::text`, '=', sql`incident.acknowledged_by::text`),
    )
    .select([
      'incident.id',
      'incident.kind',
      'incident.level',
      'incident.data',
      'incident.dedupe_key',
      'incident.started_at',
      'incident.notify_after',
      'incident.resolved_at',
      'incident.acknowledged_at',
      'incident.acknowledged_by',
      'incident.notified_open_at',
      'incident.monitor_id',
      'project.id as project_id',
      'project.name as project_name',
      'project.slug as project_slug',
      'monitor.name as monitor_name',
      'monitor.kind as monitor_kind',
      'monitor.url as monitor_url',
      'auth_user.name as acknowledged_name',
    ])
    .where('incident.org_id', '=', orgId)
    .where('incident.id', '=', id)
    .executeTakeFirst()
}

export type IncidentDetail = NonNullable<Awaited<ReturnType<typeof getIncident>>>

/** What people did on an emergency, oldest first, with their names. */
export function listIncidentEvents(db: Db, orgId: string, incidentId: string) {
  return db
    .selectFrom('incident_event')
    .leftJoin('auth_user', (join) =>
      join.on(sql`auth_user.id::text`, '=', sql`incident_event.user_id::text`),
    )
    .select([
      'incident_event.id',
      'incident_event.kind',
      'incident_event.body',
      'incident_event.at',
      'incident_event.user_id',
      'auth_user.name as user_name',
    ])
    .where('incident_event.org_id', '=', orgId)
    .where('incident_event.incident_id', '=', incidentId)
    .orderBy('incident_event.at')
    .orderBy('incident_event.id')
    .execute()
}

export async function addIncidentEvents(
  db: Db,
  orgId: string,
  incidentIds: string[],
  userId: string | null,
  kind: IncidentEventKind,
  body: string | null,
  at: Date,
) {
  if (incidentIds.length === 0) return
  await db
    .insertInto('incident_event')
    .values(
      incidentIds.map((incidentId) => ({
        id: uuidv7(at.getTime()),
        org_id: orgId,
        incident_id: incidentId,
        user_id: userId,
        kind,
        body,
        at,
      })),
    )
    .execute()
}

/** A team note on an emergency. Notes stay after it closes. */
export async function addIncidentNote(
  db: Db,
  orgId: string,
  incidentId: string,
  userId: string,
  body: string,
  at: Date,
) {
  const found = await db
    .selectFrom('incident')
    .select('id')
    .where('org_id', '=', orgId)
    .where('id', '=', incidentId)
    .executeTakeFirst()
  if (!found) return false
  await addIncidentEvents(db, orgId, [incidentId], userId, 'note', body, at)
  return true
}

/**
 * "I'm on it" or "Take over": the person takes the open emergencies, even
 * from someone else (who may have gone to sleep). Taking one you already have
 * changes nothing. Returns the incidents taken now.
 */
export async function takeIncidents(
  db: Db,
  orgId: string,
  ids: string[],
  userId: string,
  at: Date,
) {
  if (ids.length === 0) return []
  const taken = await db
    .updateTable('incident')
    .set({ acknowledged_at: at, acknowledged_by: userId })
    .where('org_id', '=', orgId)
    .where('id', 'in', ids)
    .where('resolved_at', 'is', null)
    .where((eb) => eb.or([eb('acknowledged_by', 'is', null), eb('acknowledged_by', '!=', userId)]))
    .returning('id')
    .execute()
    .then((rows) => rows.map((row) => row.id))
  await addIncidentEvents(db, orgId, taken, userId, 'took', null, at)
  return taken
}

/**
 * Closes an emergency by hand, with why: a false alarm, or fixed while the
 * checks still fail. The ones grouped under it close too.
 */
export async function closeIncident(
  db: Db,
  orgId: string,
  id: string,
  userId: string,
  note: string,
  at: Date,
) {
  const closed = await db
    .updateTable('incident')
    .set({ resolved_at: at })
    .where('org_id', '=', orgId)
    .where('id', '=', id)
    .where('resolved_at', 'is', null)
    .returning('id')
    .executeTakeFirst()
  if (!closed) return false
  await db
    .updateTable('incident')
    .set({ resolved_at: at })
    .where('parent_id', '=', id)
    .where('resolved_at', 'is', null)
    .execute()
  await addIncidentEvents(db, orgId, [id], userId, 'closed', note, at)
  return true
}

/** Each message sent about an emergency: which channel, and whether it went out. */
export function listIncidentNotifications(db: Db, orgId: string, incidentId: string) {
  return db
    .selectFrom('notification')
    .leftJoin('channel', 'channel.id', 'notification.channel_id')
    .select([
      'notification.id',
      'notification.event',
      'notification.ok',
      'notification.error',
      'notification.sent_at',
      'channel.name as channel_name',
    ])
    .where('notification.org_id', '=', orgId)
    .where(sql<boolean>`${incidentId}::uuid = any(notification.incident_ids)`)
    .orderBy('notification.sent_at')
    .execute()
}

/** The last time the same emergency happened and ended, before this one. */
export function previousIncident(db: Db, orgId: string, dedupeKey: string, before: Date) {
  return db
    .selectFrom('incident')
    .select(['id', 'started_at', 'resolved_at'])
    .where('org_id', '=', orgId)
    .where('dedupe_key', '=', dedupeKey)
    .where('started_at', '<', before)
    .where('resolved_at', 'is not', null)
    .orderBy('started_at', 'desc')
    .limit(1)
    .executeTakeFirst()
}
