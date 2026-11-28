import { uuidv7 } from '@octadash/core'
import { sql } from 'kysely'
import type { Db } from './client'
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
  return (
    db
      .selectFrom('incident')
      .innerJoin('project', 'project.id', 'incident.project_id')
      // Better Auth keys users by uuid; acknowledged_by is text.
      .leftJoin('auth_user', (join) =>
        join.on(sql<boolean>`auth_user.id::text = incident.acknowledged_by`),
      )
      .select([
        'incident.id',
        'incident.kind',
        'incident.level',
        'incident.data',
        'incident.started_at',
        'incident.notify_after',
        'incident.acknowledged_at',
        'incident.acknowledged_by',
        'auth_user.name as acknowledged_by_name',
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
  )
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
  return db
    .updateTable('incident')
    .set({ acknowledged_at: at, acknowledged_by: userId })
    .where('org_id', '=', orgId)
    .where('id', 'in', ids)
    .where('acknowledged_at', 'is', null)
    .where('resolved_at', 'is', null)
    .returning('id')
    .execute()
    .then((rows) => rows.map((row) => row.id))
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
