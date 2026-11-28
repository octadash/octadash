import { randomBytes } from 'node:crypto'
import { uuidv7 } from '@octadash/core'
import type { Db } from './client'
import type { MonitorKind, MonitorStatus } from './schema'

/** What the owner fills in. A heartbeat has no URL; the others have no token. */
export interface MonitorInput {
  name: string
  kind: MonitorKind
  url: string | null
  intervalSeconds: number
  graceSeconds: number
  /** Heartbeats only: a cron schedule instead of the interval. */
  schedule?: string | null
  /** Sites and /health: how long to wait for an answer. Default 10. */
  timeoutSeconds?: number
  /** Heartbeats only: the token already shown to the owner before saving. */
  heartbeatToken?: string
}

/** 24 random bytes in URL-safe base64: the secret part of a heartbeat URL. */
export function generateHeartbeatToken(): string {
  return randomBytes(24).toString('base64url')
}

export function isHeartbeatToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(value)
}

export function listMonitors(db: Db, orgId: string, projectId: string) {
  return db
    .selectFrom('monitor')
    .selectAll()
    .where('org_id', '=', orgId)
    .where('project_id', '=', projectId)
    .orderBy('created_at')
    .execute()
}

/** Every monitor of an organization, for the overview. */
export function listOrgMonitors(db: Db, orgId: string) {
  return db
    .selectFrom('monitor')
    .selectAll()
    .where('org_id', '=', orgId)
    .orderBy('created_at')
    .execute()
}

export function getMonitor(db: Db, orgId: string, monitorId: string) {
  return db
    .selectFrom('monitor')
    .selectAll()
    .where('org_id', '=', orgId)
    .where('id', '=', monitorId)
    .executeTakeFirst()
}

export async function createMonitor(db: Db, orgId: string, projectId: string, input: MonitorInput) {
  const heartbeat = input.kind === 'heartbeat'
  // The product must belong to the organization; the insert reads it from there.
  const row = await db
    .insertInto('monitor')
    .columns([
      'id',
      'org_id',
      'project_id',
      'name',
      'kind',
      'url',
      'interval_seconds',
      'grace_seconds',
      'heartbeat_token',
      'schedule',
      'timeout_seconds',
    ])
    .expression((eb) =>
      eb
        .selectFrom('project')
        .select([
          eb.val(uuidv7()).as('id'),
          'org_id',
          'id as project_id',
          eb.val(input.name.trim()).as('name'),
          eb.val(input.kind).as('kind'),
          eb.val(heartbeat ? null : input.url).as('url'),
          eb.val(input.intervalSeconds).as('interval_seconds'),
          eb.val(input.graceSeconds).as('grace_seconds'),
          eb
            .val(
              heartbeat
                ? input.heartbeatToken && isHeartbeatToken(input.heartbeatToken)
                  ? input.heartbeatToken
                  : generateHeartbeatToken()
                : null,
            )
            .as('heartbeat_token'),
          eb.val(heartbeat ? (input.schedule ?? null) : null).as('schedule'),
          eb.val(input.timeoutSeconds ?? 10).as('timeout_seconds'),
        ])
        .where('org_id', '=', orgId)
        .where('id', '=', projectId),
    )
    .returningAll()
    .executeTakeFirst()
  return row ?? null
}

/** Changes what the owner set. The kind is fixed at creation (a heartbeat keeps its URL). */
export async function updateMonitor(
  db: Db,
  orgId: string,
  monitorId: string,
  input: Omit<MonitorInput, 'kind' | 'heartbeatToken'> & { paused?: boolean },
) {
  const current = await getMonitor(db, orgId, monitorId)
  if (!current) return null
  return db
    .updateTable('monitor')
    .set({
      name: input.name.trim(),
      url: current.kind === 'heartbeat' ? null : input.url,
      interval_seconds: input.intervalSeconds,
      grace_seconds: input.graceSeconds,
      ...(input.schedule === undefined
        ? {}
        : { schedule: current.kind === 'heartbeat' ? input.schedule : null }),
      ...(input.timeoutSeconds === undefined ? {} : { timeout_seconds: input.timeoutSeconds }),
      ...(input.paused === undefined ? {} : { paused: input.paused }),
      updated_at: new Date(),
    })
    .where('org_id', '=', orgId)
    .where('id', '=', monitorId)
    .returningAll()
    .executeTakeFirst()
}

export async function deleteMonitor(db: Db, orgId: string, monitorId: string) {
  const result = await db
    .deleteFrom('monitor')
    .where('org_id', '=', orgId)
    .where('id', '=', monitorId)
    .executeTakeFirst()
  return result.numDeletedRows > 0n
}

/** The heartbeat monitor a ping URL belongs to. The ingest caches the answer. */
export function findHeartbeatMonitor(db: Db, token: string) {
  return db
    .selectFrom('monitor')
    .select(['id'])
    .where('heartbeat_token', '=', token)
    .executeTakeFirst()
}

/** Every monitor that runs, across organizations. Only the worker calls this. */
export function listActiveMonitors(db: Db) {
  return db
    .selectFrom('monitor')
    .leftJoin('organization_settings', 'organization_settings.org_id', 'monitor.org_id')
    .select([
      'monitor.id',
      'monitor.org_id',
      'monitor.project_id',
      'monitor.name',
      'monitor.kind',
      'monitor.url',
      'monitor.interval_seconds',
      'monitor.grace_seconds',
      'monitor.heartbeat_token',
      'monitor.schedule',
      'monitor.timeout_seconds',
      'monitor.status',
      'monitor.status_since',
      'monitor.updated_at',
      'organization_settings.time_zone',
    ])
    .where('monitor.paused', '=', false)
    .execute()
}

export type ActiveMonitor = Awaited<ReturnType<typeof listActiveMonitors>>[number]

/**
 * Records a state change. Returns false when another change already won (the
 * monitor was edited, deleted or flipped meanwhile), so one outage opens once.
 */
export async function setMonitorStatus(
  db: Db,
  monitorId: string,
  from: MonitorStatus,
  to: MonitorStatus,
  at: Date,
) {
  const result = await db
    .updateTable('monitor')
    .set({ status: to, status_since: at })
    .where('id', '=', monitorId)
    .where('status', '=', from)
    .executeTakeFirst()
  return result.numUpdatedRows > 0n
}
