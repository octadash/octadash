import type { Bucket, MonitorKind, MonitorStatus } from '@octadash/db'
import { judgeHeartbeat } from '@octadash/uptime/heartbeat'

/**
 * The rules of the Uptime board, apart from the page so they can be tested:
 * the periods, what each monitor's "Now" says, the worst state of a product,
 * the colour of a bar, and which emergencies share an address.
 */

export const UPTIME_PERIODS = ['24h', '7d', '45d', '90d'] as const
export type UptimePeriodId = (typeof UPTIME_PERIODS)[number]

const DAY = 86_400_000
const LENGTH: Record<UptimePeriodId, number> = {
  '24h': DAY,
  '7d': 7 * DAY,
  '45d': 45 * DAY,
  '90d': 90 * DAY,
}

export interface UptimePeriod {
  id: UptimePeriodId
  from: Date
  to: Date
  previous: { from: Date; to: Date }
  /** One bar per hour over a day, per day otherwise. */
  bucket: Bucket
}

export function parseUptimePeriod(value: string | string[] | undefined): UptimePeriodId {
  return UPTIME_PERIODS.find((p) => p === value) ?? '45d'
}

export function uptimePeriod(id: UptimePeriodId, now: Date): UptimePeriod {
  const length = LENGTH[id]
  const from = new Date(now.getTime() - length)
  return {
    id,
    from,
    to: now,
    previous: { from: new Date(from.getTime() - length), to: from },
    bucket: id === '24h' ? 'hour' : 'day',
  }
}

/** Certificates this close to expiring are counted and painted amber. */
export const CERT_WARN_DAYS = 14
/** "Slow": the last hour's median is at least this long... */
export const SLOW_MIN_MS = 2000
/** ...and at least this many times the period's median. */
export const SLOW_FACTOR = 2
/** Emergencies on the same address this close together get the same-server note. */
export const SAME_IP_WINDOW_MS = 10 * 60_000

export type MonitorState =
  | { state: 'down'; since: Date | null; reason: string | null }
  | { state: 'late'; due: Date }
  | { state: 'slow'; medianMs: number }
  | { state: 'waiting' }
  | { state: 'up'; lastCall: Date | null }
  | { state: 'paused' }

export type StateName = MonitorState['state']

/** Problems first: the order of products and monitors on the board. */
export const STATE_ORDER: Record<StateName, number> = {
  down: 0,
  late: 1,
  slow: 2,
  waiting: 3,
  up: 4,
  paused: 5,
}

export interface BoardMonitor {
  kind: MonitorKind
  status: MonitorStatus
  status_since: Date | null
  paused: boolean
  interval_seconds: number
  grace_seconds: number
  schedule: string | null
  updated_at: Date
}

export interface MonitorNumbers {
  lastAt: Date | null
  lastUp: boolean | null
  lastError: string | null
  /** Median over the period shown. */
  periodMedianMs: number | null
  /** Median over the last hour. */
  recentMedianMs: number | null
}

/** What the "Now" column says about one monitor. */
export function monitorState(
  monitor: BoardMonitor,
  numbers: MonitorNumbers,
  timeZone: string,
  now: Date,
): MonitorState {
  if (monitor.paused) return { state: 'paused' }
  if (monitor.status === 'down') {
    return { state: 'down', since: monitor.status_since, reason: numbers.lastError }
  }
  if (monitor.kind === 'heartbeat') {
    const lastCall = numbers.lastUp ? numbers.lastAt : null
    // Past its time but still inside the grace: late, not yet down.
    const judged = judgeHeartbeat(
      {
        intervalSeconds: monitor.interval_seconds,
        schedule: monitor.schedule,
        graceSeconds: 0,
        timeZone,
      },
      { lastCall, lastFail: null, since: monitor.updated_at },
      now,
    )
    if (judged.state === 'late' && monitor.status === 'up')
      return { state: 'late', due: judged.due }
    if (monitor.status === 'unknown' && !lastCall) return { state: 'waiting' }
    return { state: 'up', lastCall }
  }
  if (monitor.status === 'unknown' || numbers.lastAt === null) return { state: 'waiting' }
  const { recentMedianMs: recent, periodMedianMs: usual } = numbers
  if (
    recent !== null &&
    recent >= SLOW_MIN_MS &&
    (usual === null || recent >= usual * SLOW_FACTOR)
  ) {
    return { state: 'slow', medianMs: recent }
  }
  return { state: 'up', lastCall: null }
}

/** The state that speaks for several monitors: the worst one. */
export function worstState<T extends { state: MonitorState }>(items: T[]): T | null {
  let worst: T | null = null
  for (const item of items) {
    if (!worst || STATE_ORDER[item.state.state] < STATE_ORDER[worst.state.state]) worst = item
  }
  return worst
}

export type BarState = 'up' | 'partial' | 'down' | 'none'

/**
 * One bar: gray without checks, green when every check passed, amber when a
 * few failed, red when most of them did.
 */
export function barState(bucket: { checks: number; downs: number }): BarState {
  if (bucket.checks === 0) return 'none'
  if (bucket.downs === 0) return 'up'
  return bucket.downs * 2 >= bucket.checks ? 'down' : 'partial'
}

export interface OpenMonitorIncident {
  id: string
  kind: string
  project_id: string
  project_name: string
  project_slug: string
  started_at: Date
  data: Record<string, unknown>
}

export interface SameIpGroup {
  ip: string
  incidents: OpenMonitorIncident[]
  /** Minutes between the first and the last to go down. */
  apartMinutes: number
}

/**
 * Open "down" emergencies of different products that resolve to the same
 * address and started close together: maybe one server. Only a hint; each
 * emergency stays its own.
 */
export function sameIpGroups(incidents: OpenMonitorIncident[]): SameIpGroup[] {
  const byIp = new Map<string, OpenMonitorIncident[]>()
  for (const incident of incidents) {
    const ip = incident.data.ip
    if (incident.kind !== 'monitor_down' || typeof ip !== 'string' || !ip) continue
    byIp.set(ip, [...(byIp.get(ip) ?? []), incident])
  }
  const groups: SameIpGroup[] = []
  for (const [ip, list] of byIp) {
    const sorted = [...list].sort((a, b) => a.started_at.getTime() - b.started_at.getTime())
    let run: OpenMonitorIncident[] = []
    const close = () => {
      if (new Set(run.map((i) => i.project_id)).size >= 2) {
        const first = run[0] as OpenMonitorIncident
        const last = run[run.length - 1] as OpenMonitorIncident
        groups.push({
          ip,
          incidents: run,
          apartMinutes: Math.round(
            (last.started_at.getTime() - first.started_at.getTime()) / 60_000,
          ),
        })
      }
    }
    for (const incident of sorted) {
      const previous = run[run.length - 1]
      if (
        previous &&
        incident.started_at.getTime() - previous.started_at.getTime() > SAME_IP_WINDOW_MS
      ) {
        close()
        run = []
      }
      run.push(incident)
    }
    close()
  }
  return groups
}

/** "HTTP 502" reads as "502" in a narrow column; anything else is left to the caller. */
export function statusCodeOf(reason: string | null): string | null {
  const match = reason?.match(/^HTTP (\d{3})$/)
  return match?.[1] ?? null
}
