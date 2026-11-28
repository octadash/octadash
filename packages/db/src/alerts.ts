import { uuidv7 } from '@octadash/core'
import { sql } from 'kysely'
import type { Db } from './client'
import { addIncidentEvents } from './emergency'
import type { AlertLevel } from './schema'

/**
 * The kinds of incident this version raises, with their seeded rule. New kinds
 * (error spike, checkout stopped, AI cost runaway...) are added here with
 * their areas; nothing else needs to know the list.
 */
export const RULE_DEFAULTS = {
  /** A site or health monitor is down. `minutes`: how long before telling anyone. */
  monitor_down: { level: 'emergency', params: { minutes: 2 } },
  /** A heartbeat stopped: a cron job, backup or worker did not run. */
  heartbeat_missed: { level: 'emergency', params: {} },
  /** A certificate expires in `days` or fewer. */
  cert_expiring: { level: 'emergency', params: { days: 7 } },
} as const satisfies Record<string, { level: AlertLevel | 'off'; params: Record<string, number> }>

export type IncidentKind = keyof typeof RULE_DEFAULTS
export const INCIDENT_KINDS = Object.keys(RULE_DEFAULTS) as IncidentKind[]

export interface Rule {
  kind: string
  level: AlertLevel | 'off'
  params: Record<string, number>
  channelIds: string[] | null
  /** True when this product has its own setting instead of the organization's. */
  overridden: boolean
}

/** Seeds the organization's rules once. Safe to call any number of times. */
export async function ensureDefaultRules(db: Db, orgId: string) {
  await db
    .insertInto('alert_rule')
    .values(
      INCIDENT_KINDS.map((kind) => ({
        id: uuidv7(),
        org_id: orgId,
        project_id: null,
        kind,
        level: RULE_DEFAULTS[kind].level,
        params: JSON.stringify(RULE_DEFAULTS[kind].params),
        channel_ids: null,
      })),
    )
    .onConflict((oc) => oc.doNothing())
    .execute()
}

/** The rules that apply to a product (or the organization's defaults when projectId is null). */
export async function listRules(db: Db, orgId: string, projectId: string | null): Promise<Rule[]> {
  await ensureDefaultRules(db, orgId)
  const rows = await db
    .selectFrom('alert_rule')
    .selectAll()
    .where('org_id', '=', orgId)
    .where((eb) =>
      projectId
        ? eb.or([eb('project_id', 'is', null), eb('project_id', '=', projectId)])
        : eb('project_id', 'is', null),
    )
    .execute()
  return INCIDENT_KINDS.map((kind) => {
    const own = rows.find((row) => row.kind === kind && row.project_id !== null)
    const base = rows.find((row) => row.kind === kind && row.project_id === null)
    const row = own ?? base
    return {
      kind,
      level: row?.level ?? RULE_DEFAULTS[kind].level,
      params: { ...RULE_DEFAULTS[kind].params, ...((row?.params as Record<string, number>) ?? {}) },
      channelIds: row?.channel_ids ?? null,
      overridden: Boolean(own),
    }
  })
}

export async function ruleFor(db: Db, orgId: string, projectId: string, kind: IncidentKind) {
  const rules = await listRules(db, orgId, projectId)
  return rules.find((rule) => rule.kind === kind) as Rule
}

/** Saves a rule for the organization (projectId null) or for one product. */
export async function saveRule(
  db: Db,
  orgId: string,
  projectId: string | null,
  kind: IncidentKind,
  rule: { level: AlertLevel | 'off'; params: Record<string, number>; channelIds: string[] | null },
) {
  if (projectId) {
    const owned = await db
      .selectFrom('project')
      .select('id')
      .where('org_id', '=', orgId)
      .where('id', '=', projectId)
      .executeTakeFirst()
    if (!owned) return false
  }
  await db
    .insertInto('alert_rule')
    .values({
      id: uuidv7(),
      org_id: orgId,
      project_id: projectId,
      kind,
      level: rule.level,
      params: JSON.stringify(rule.params),
      channel_ids: rule.channelIds,
    })
    .onConflict((oc) =>
      oc.columns(['org_id', 'project_id', 'kind']).doUpdateSet({
        level: rule.level,
        params: JSON.stringify(rule.params),
        channel_ids: rule.channelIds,
        updated_at: new Date(),
      }),
    )
    .execute()
  return true
}

/** Drops a product's own rule, so it follows the organization's again. */
export async function resetRule(db: Db, orgId: string, projectId: string, kind: IncidentKind) {
  await db
    .deleteFrom('alert_rule')
    .where('org_id', '=', orgId)
    .where('project_id', '=', projectId)
    .where('kind', '=', kind)
    .execute()
}

export interface OpenIncidentInput {
  orgId: string
  projectId: string
  monitorId?: string | null
  kind: IncidentKind
  /** One open incident per key: "monitor:<id>:down", "monitor:<id>:cert". */
  dedupeKey: string
  data: Record<string, unknown>
  at: Date
}

/**
 * Opens an incident unless one with the same key is open or the rule is off.
 * Returns the new incident, or null.
 */
export async function openIncident(db: Db, input: OpenIncidentInput) {
  const rule = await ruleFor(db, input.orgId, input.projectId, input.kind)
  if (rule.level === 'off') return null
  const delayMinutes = rule.params.minutes ?? 0
  const row = await db
    .insertInto('incident')
    .values({
      id: uuidv7(input.at.getTime()),
      org_id: input.orgId,
      project_id: input.projectId,
      monitor_id: input.monitorId ?? null,
      parent_id: null,
      kind: input.kind,
      level: rule.level,
      dedupe_key: input.dedupeKey,
      data: JSON.stringify(input.data),
      channel_ids: rule.channelIds,
      started_at: input.at,
      notify_after: new Date(input.at.getTime() + delayMinutes * 60_000),
      resolved_at: null,
      acknowledged_at: null,
      notified_open_at: null,
      notified_resolve_at: null,
    })
    .onConflict((oc) => oc.column('dedupe_key').where('resolved_at', 'is', null).doNothing())
    .returningAll()
    .executeTakeFirst()
  return row ?? null
}

/** Closes the open incident with this key, and the ones grouped under it. */
export async function resolveIncident(db: Db, dedupeKey: string, at: Date) {
  const resolved = await db
    .updateTable('incident')
    .set({ resolved_at: at })
    .where('dedupe_key', '=', dedupeKey)
    .where('resolved_at', 'is', null)
    .returning(['id'])
    .executeTakeFirst()
  if (!resolved) return null
  await db
    .updateTable('incident')
    .set({ resolved_at: at })
    .where('parent_id', '=', resolved.id)
    .where('resolved_at', 'is', null)
    .execute()
  return resolved.id
}

/** Open incidents of an organization, newest first, with the product name. */
export function listOpenIncidents(db: Db, orgId: string) {
  return db
    .selectFrom('incident')
    .innerJoin('project', 'project.id', 'incident.project_id')
    .select([
      'incident.id',
      'incident.kind',
      'incident.level',
      'incident.data',
      'incident.started_at',
      'incident.notify_after',
      'incident.acknowledged_at',
      'incident.acknowledged_by',
      'incident.parent_id',
      'incident.monitor_id',
      'project.id as project_id',
      'project.name as project_name',
      'project.slug as project_slug',
    ])
    .where('incident.org_id', '=', orgId)
    .where('incident.resolved_at', 'is', null)
    .orderBy('incident.started_at', 'desc')
    .execute()
}

/**
 * Emergencies that ended since `since`, newest first: the strip turns green
 * for a moment ("Acme Shop is back"). `closedBy` is set when someone closed
 * it by hand instead of the check passing.
 */
export function listResolvedSince(db: Db, orgId: string, since: Date) {
  return db
    .selectFrom('incident')
    .innerJoin('project', 'project.id', 'incident.project_id')
    .select((eb) => [
      'incident.id',
      'incident.kind',
      'incident.data',
      'incident.started_at',
      'incident.resolved_at',
      'incident.notify_after',
      'incident.acknowledged_by',
      'project.name as project_name',
      'project.slug as project_slug',
      eb
        .selectFrom('incident_event')
        .select('incident_event.user_id')
        .whereRef('incident_event.incident_id', '=', 'incident.id')
        .where('incident_event.kind', '=', 'closed')
        .orderBy('incident_event.at', 'desc')
        .limit(1)
        .as('closed_by'),
    ])
    .where('incident.org_id', '=', orgId)
    .where('incident.level', '=', 'emergency')
    .where('incident.resolved_at', '>=', since)
    .orderBy('incident.resolved_at', 'desc')
    .limit(20)
    .execute()
}

/**
 * Incidents that were open at some point of a period, oldest first: the "What
 * happened" timeline. `projectIds` null means every product; an empty list
 * matches nothing. Child incidents (one product down because its server is)
 * come along with their `parent_id`.
 */
export async function listIncidentsBetween(
  db: Db,
  orgId: string,
  projectIds: string[] | null,
  from: Date,
  to: Date,
) {
  if (projectIds?.length === 0) return []
  let query = db
    .selectFrom('incident')
    .select([
      'id',
      'project_id',
      'monitor_id',
      'parent_id',
      'kind',
      'level',
      'data',
      'started_at',
      'resolved_at',
      'acknowledged_by',
    ])
    .where('org_id', '=', orgId)
    .where('started_at', '<', to)
    .where((eb) => eb.or([eb('resolved_at', 'is', null), eb('resolved_at', '>=', from)]))
  if (projectIds) query = query.where('project_id', 'in', projectIds)
  return query.orderBy('started_at').execute()
}

/**
 * Someone takes the emergencies: the strip says who and since when, for
 * everyone. The first person wins; taking an incident someone already took, or
 * one already over, changes nothing. Returns the incidents taken now.
 */
export async function acknowledgeIncidents(
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
    .where('acknowledged_at', 'is', null)
    .where('resolved_at', 'is', null)
    .returning('id')
    .execute()
    .then((rows) => rows.map((row) => row.id))
  await addIncidentEvents(db, orgId, taken, userId, 'took', null, at)
  return taken
}

/**
 * Incidents waiting for a message: opened and past their delay, or resolved
 * after their opening was told. Locked, so two workers never send the same one.
 * Incidents resolved before anyone was told are closed silently (a blip).
 */
export async function claimPendingIncidents(trx: Db, now: Date) {
  await trx
    .updateTable('incident')
    .set({ notified_open_at: sql`resolved_at`, notified_resolve_at: sql`resolved_at` })
    .where('notified_open_at', 'is', null)
    .where('resolved_at', 'is not', null)
    .execute()
  return trx
    .selectFrom('incident')
    .innerJoin('project', 'project.id', 'incident.project_id')
    .select([
      'incident.id',
      'incident.org_id',
      'incident.kind',
      'incident.level',
      'incident.data',
      'incident.channel_ids',
      'incident.started_at',
      'incident.resolved_at',
      'incident.notified_open_at',
      'incident.parent_id',
      'project.id as project_id',
      'project.name as project_name',
      'project.slug as project_slug',
    ])
    .where((eb) =>
      eb.or([
        eb.and([
          eb('incident.notified_open_at', 'is', null),
          eb('incident.resolved_at', 'is', null),
          eb('incident.notify_after', '<=', now),
        ]),
        eb.and([
          eb('incident.resolved_at', 'is not', null),
          eb('incident.notified_resolve_at', 'is', null),
        ]),
      ]),
    )
    .where('incident.level', '=', 'emergency')
    .orderBy('incident.started_at')
    .forUpdate('incident')
    .skipLocked()
    .execute()
}

export type PendingIncident = Awaited<ReturnType<typeof claimPendingIncidents>>[number]

export async function markNotified(trx: Db, ids: string[], event: 'open' | 'resolve', at: Date) {
  if (ids.length === 0) return
  await trx
    .updateTable('incident')
    .set(event === 'open' ? { notified_open_at: at } : { notified_resolve_at: at })
    .where('id', 'in', ids)
    .execute()
}

export async function recordNotification(
  db: Db,
  input: {
    orgId: string
    channelId: string
    incidentIds: string[]
    event: 'open' | 'resolve'
    ok: boolean
    error?: string | null
  },
) {
  await db
    .insertInto('notification')
    .values({
      id: uuidv7(),
      org_id: input.orgId,
      channel_id: input.channelId,
      incident_ids: input.incidentIds,
      event: input.event,
      ok: input.ok,
      error: input.error ?? null,
    })
    .execute()
}

/** Open incidents of a kind across every organization, for the jobs that resolve them. */
export function listOpenIncidentKeys(db: Db, kind: IncidentKind) {
  return db
    .selectFrom('incident')
    .select(['dedupe_key', 'monitor_id'])
    .where('kind', '=', kind)
    .where('resolved_at', 'is', null)
    .execute()
}

/**
 * Closes, without a message, monitor incidents left open after their monitor
 * was paused, edited or found up by another path. Saying "back up" for a
 * monitor someone paused would be false. Returns the organization of each
 * incident closed.
 */
export async function closeStaleMonitorIncidents(db: Db, at: Date) {
  const rows = await db
    .updateTable('incident')
    .set({ resolved_at: at, notified_resolve_at: at })
    .from('monitor')
    .whereRef('monitor.id', '=', 'incident.monitor_id')
    .where('incident.kind', 'in', ['monitor_down', 'heartbeat_missed'])
    .where('incident.resolved_at', 'is', null)
    .where((eb) => eb.or([eb('monitor.paused', '=', true), eb('monitor.status', '<>', 'down')]))
    .returning('incident.org_id')
    .execute()
  return rows.map((row) => row.org_id)
}

/** The products that changed a rule of the organization, with their own setting, by name. */
export async function listRuleOverrides(db: Db, orgId: string) {
  const rows = await db
    .selectFrom('alert_rule')
    .innerJoin('project', 'project.id', 'alert_rule.project_id')
    .select([
      'alert_rule.kind',
      'alert_rule.level',
      'alert_rule.params',
      'project.name',
      'project.slug',
    ])
    .where('alert_rule.org_id', '=', orgId)
    .where('alert_rule.project_id', 'is not', null)
    .orderBy('project.name')
    .execute()
  return rows.map((row) => ({
    kind: row.kind,
    level: row.level,
    params: (row.params as Record<string, number>) ?? {},
    product: { name: row.name, slug: row.slug },
  }))
}

export interface Happening {
  at: Date
  /** `down`: an emergency began; `signal`: a signal began; `back`: it ended; `took`: someone is on it. */
  kind: 'down' | 'signal' | 'back' | 'took'
  incident: string
  projectId: string
  product: string
  /** The monitor's name, when the incident has one. */
  name: string | null
  /** Who took it, for `took`; who closed it by hand, for `back`. */
  person: string | null
}

/**
 * What happened since a moment, newest first, for the TV's "What happened"
 * line: emergencies and signals that began (once their wait was over), ended
 * and were taken.
 */
export async function listHappenings(
  db: Db,
  orgId: string,
  since: Date,
  limit = 12,
  now = new Date(),
): Promise<Happening[]> {
  const base = db
    .selectFrom('incident')
    .innerJoin('project', 'project.id', 'incident.project_id')
    .where('incident.org_id', '=', orgId)
    .where('incident.parent_id', 'is', null)
    .where('incident.notify_after', '<=', now)
  const [started, ended, took] = await Promise.all([
    base
      .select([
        'incident.started_at as at',
        'incident.kind',
        'incident.level',
        'incident.data',
        'project.id as project_id',
        'project.name as product',
      ])
      .where('incident.started_at', '>=', since)
      .orderBy('incident.started_at', 'desc')
      .limit(limit)
      .execute(),
    base
      .select([
        'incident.resolved_at as at',
        'incident.kind',
        'incident.data',
        'project.id as project_id',
        'project.name as product',
        (eb) =>
          eb
            .selectFrom('incident_event')
            .innerJoin('auth_user', 'auth_user.id', 'incident_event.user_id')
            .select('auth_user.name')
            .whereRef('incident_event.incident_id', '=', 'incident.id')
            .where('incident_event.kind', '=', 'closed')
            .limit(1)
            .as('closer'),
      ])
      .where('incident.resolved_at', '>=', since)
      .orderBy('incident.resolved_at', 'desc')
      .limit(limit)
      .execute(),
    db
      .selectFrom('incident_event')
      .innerJoin('incident', 'incident.id', 'incident_event.incident_id')
      .innerJoin('project', 'project.id', 'incident.project_id')
      .leftJoin('auth_user', 'auth_user.id', 'incident_event.user_id')
      .select([
        'incident_event.at',
        'incident.kind',
        'incident.data',
        'project.id as project_id',
        'project.name as product',
        'auth_user.name as person',
      ])
      .where('incident_event.org_id', '=', orgId)
      .where('incident_event.kind', '=', 'took')
      .where('incident_event.at', '>=', since)
      .orderBy('incident_event.at', 'desc')
      .limit(limit)
      .execute(),
  ])
  const nameOf = (data: unknown) => {
    const name = (data as { name?: unknown } | null)?.name
    return typeof name === 'string' ? name : null
  }
  const all: Happening[] = [
    ...started.map((r) => ({
      at: r.at,
      kind: r.level === 'emergency' ? ('down' as const) : ('signal' as const),
      incident: r.kind,
      projectId: r.project_id,
      product: r.product,
      name: nameOf(r.data),
      person: null,
    })),
    ...ended.map((r) => ({
      at: r.at as Date,
      kind: 'back' as const,
      incident: r.kind,
      projectId: r.project_id,
      product: r.product,
      name: nameOf(r.data),
      person: r.closer ?? null,
    })),
    ...took.map((r) => ({
      at: r.at,
      kind: 'took' as const,
      incident: r.kind,
      projectId: r.project_id,
      product: r.product,
      name: nameOf(r.data),
      person: r.person ?? null,
    })),
  ]
  return all.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit)
}
