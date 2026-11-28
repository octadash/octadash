import {
  type CheckPoint,
  getIncident,
  type IncidentDetail,
  listIncidentEvents,
  listIncidentNotifications,
  listMembers,
  listOpenIncidents,
  monitorChecks,
  previousIncident,
} from '@octadash/db'
import type { Diagnosis } from '@octadash/uptime/diagnose'
import { SAME_IP_WINDOW_MS } from '@/lib/uptime-board'
import { services } from './context'

/** How much of the monitor's history the chart shows around the failure. */
const BEFORE_MS = 45 * 60_000
const AFTER_MS = 15 * 60_000
/** Other emergencies this close in time are "at the same time". */
const SAME_TIME_MS = 60 * 60_000

export type TimelineEntry =
  | { kind: 'firstFailure'; at: Date; reason: string; ms: number | null }
  | { kind: 'opened'; at: Date; failures: number | null }
  | { kind: 'sameIp'; at: Date; product: string; name: string }
  | {
      kind: 'told'
      at: Date
      event: 'open' | 'resolve'
      channels: { name: string; ok: boolean; error: string | null }[]
    }
  | { kind: 'took'; at: Date; name: string; first: boolean }
  | { kind: 'note'; at: Date; name: string; body: string }
  | { kind: 'closed'; at: Date; name: string; body: string }
  | { kind: 'resolved'; at: Date }

export interface SameTime {
  id: string
  product: string
  slug: string
  name: string
  startedAt: Date
  takenBy: string | null
  sameIp: boolean
}

export interface Emergency {
  incident: IncidentDetail
  data: Record<string, unknown>
  checked: (Diagnosis & { at?: string }) | null
  checks: CheckPoint[]
  /** Failed checks in a row up to now (or up to the end). */
  failures: number | null
  window: { from: Date; to: Date }
  timeline: TimelineEntry[]
  sameTime: SameTime[]
  previous: { id: string; startedAt: Date; minutes: number } | null
  /** ClickHouse did not answer: no chart, the rest is there. */
  complete: boolean
}

export async function loadEmergency(
  orgId: string,
  id: string,
  now = new Date(),
): Promise<Emergency | null> {
  const { db, clickhouse } = services()
  const incident = await getIncident(db, orgId, id)
  if (!incident) return null
  const data = (incident.data ?? {}) as Record<string, unknown>
  const end = incident.resolved_at ?? now
  const window = {
    from: new Date(incident.started_at.getTime() - BEFORE_MS),
    to: new Date(Math.min(now.getTime(), end.getTime() + AFTER_MS)),
  }

  let complete = true
  const [events, notifications, previous, open, members, checks] = await Promise.all([
    listIncidentEvents(db, orgId, id),
    listIncidentNotifications(db, orgId, id),
    previousIncident(db, orgId, incident.dedupe_key, incident.started_at),
    listOpenIncidents(db, orgId),
    listMembers(db, orgId),
    incident.monitor_id
      ? monitorChecks(clickhouse, orgId, incident.monitor_id, window.from, window.to).catch(() => {
          complete = false
          return [] as CheckPoint[]
        })
      : Promise.resolve([] as CheckPoint[]),
  ])

  // A monitor younger than the window: start the chart at its first check.
  const first = checks[0]
  if (first && first.at.getTime() - 60_000 > window.from.getTime()) {
    window.from = new Date(first.at.getTime() - 60_000)
  }

  // The run of failures that opened it: from the last pass before it opened.
  const before = checks.filter((c) => c.at <= incident.started_at)
  const lastUp = before.findLast((c) => c.up)
  const run = checks.filter(
    (c) => !c.up && (!lastUp || c.at > lastUp.at) && c.at <= (incident.resolved_at ?? now),
  )
  const firstFailure = run[0]
  const ip = typeof data.ip === 'string' ? data.ip : null

  const sameTime: SameTime[] = open
    .filter(
      (other) =>
        other.id !== id &&
        Math.abs(other.started_at.getTime() - incident.started_at.getTime()) <= SAME_TIME_MS,
    )
    .map((other) => {
      const d = (other.data ?? {}) as Record<string, unknown>
      return {
        id: other.id,
        product: other.project_name,
        slug: other.project_slug,
        name: typeof d.name === 'string' ? d.name : other.kind,
        startedAt: other.started_at,
        takenBy: other.acknowledged_by
          ? (members.find((m) => m.userId === other.acknowledged_by)?.name ?? '?')
          : null,
        sameIp: !!ip && d.ip === ip,
      }
    })
    .sort((a, b) => Number(b.sameIp) - Number(a.sameIp) || +a.startedAt - +b.startedAt)

  const timeline: TimelineEntry[] = []
  if (firstFailure && firstFailure.at < incident.started_at) {
    timeline.push({
      kind: 'firstFailure',
      at: firstFailure.at,
      reason: firstFailure.error || `HTTP ${firstFailure.statusCode}`,
      ms: firstFailure.durationMs,
    })
  }
  timeline.push({
    kind: 'opened',
    at: incident.started_at,
    failures: incident.kind === 'monitor_down' ? 3 : null,
  })
  for (const other of sameTime) {
    if (other.sameIp && Math.abs(+other.startedAt - +incident.started_at) <= SAME_IP_WINDOW_MS) {
      timeline.push({
        kind: 'sameIp',
        at: other.startedAt,
        product: other.product,
        name: other.name,
      })
    }
  }
  const told = new Map<string, TimelineEntry & { kind: 'told' }>()
  for (const n of notifications) {
    // One line per round of messages: the channels told within the same minute.
    const key = `${n.event}:${Math.floor(n.sent_at.getTime() / 60_000)}`
    const entry = told.get(key) ?? { kind: 'told', at: n.sent_at, event: n.event, channels: [] }
    entry.channels.push({ name: n.channel_name ?? '?', ok: n.ok, error: n.error })
    told.set(key, entry)
  }
  timeline.push(...told.values())
  let firstTake = true
  for (const e of events) {
    const name = e.user_name ?? '?'
    if (e.kind === 'took') {
      timeline.push({ kind: 'took', at: e.at, name, first: firstTake })
      firstTake = false
    } else if (e.kind === 'note') {
      timeline.push({ kind: 'note', at: e.at, name, body: e.body ?? '' })
    } else {
      timeline.push({ kind: 'closed', at: e.at, name, body: e.body ?? '' })
    }
  }
  if (incident.resolved_at && !events.some((e) => e.kind === 'closed')) {
    timeline.push({ kind: 'resolved', at: incident.resolved_at })
  }
  timeline.sort((a, b) => a.at.getTime() - b.at.getTime())

  return {
    incident,
    data,
    checked:
      data.checked && typeof data.checked === 'object'
        ? (data.checked as Diagnosis & { at?: string })
        : null,
    checks,
    failures: incident.kind === 'monitor_down' && run.length > 0 ? run.length : null,
    window,
    timeline,
    sameTime,
    previous: previous
      ? {
          id: previous.id,
          startedAt: previous.started_at,
          minutes: Math.max(
            1,
            Math.round(
              ((previous.resolved_at as Date).getTime() - previous.started_at.getTime()) / 60_000,
            ),
          ),
        }
      : null,
    complete,
  }
}
