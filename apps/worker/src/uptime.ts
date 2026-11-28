import type { Logger } from '@octadash/core'
import type { ActiveMonitor, MonitorStatus, UptimeCheckRow } from '@octadash/db'
import { toClickHouseTime } from '@octadash/db'
import type { CheckOptions, CheckResult } from '@octadash/uptime'

/** Failed checks in a row before a site or health monitor is down. */
export const FAILURES_TO_DOWN = 3
/** After a failure the next check comes sooner, to confirm or clear it. */
const RETRY_AFTER_FAILURE_MS = 20_000
/** The certificate and the http to https redirect are read about once an hour. */
const DEEP_EVERY_MS = 3_600_000
/** Heartbeat pings are compared this often. */
const HEARTBEAT_EVERY_MS = 10_000
const MAX_BUFFERED_ROWS = 100_000

export interface Transition {
  monitor: ActiveMonitor
  from: MonitorStatus
  to: MonitorStatus
  at: Date
  /** What the last check saw: "HTTP 503", "timeout", "no ping for 65 min". */
  reason: string | null
}

export interface UptimeDeps {
  loadMonitors(): Promise<ActiveMonitor[]>
  check(url: string, options: CheckOptions): Promise<CheckResult>
  readPings(monitorIds: string[]): Promise<Map<string, number>>
  writeRows(rows: UptimeCheckRow[]): Promise<void>
  /** Saves a state change; false when the monitor changed meanwhile. */
  setStatus(monitorId: string, from: MonitorStatus, to: MonitorStatus, at: Date): Promise<boolean>
  onTransition(transition: Transition): Promise<void>
  /**
   * Can this server reach the internet? Asked before calling anything down, so
   * a network failure on Octadash's side does not read as every product down.
   */
  isOnline(): Promise<boolean>
  now(): number
  log: Logger
  allowPrivate?: boolean
  concurrency?: number
}

interface Slot {
  monitor: ActiveMonitor
  status: MonitorStatus
  nextAt: number
  failures: number
  running: boolean
  lastDeepAt: number
  lastPing: number | null
}

/**
 * Runs every monitor on time from memory, so a check every minute costs no
 * Postgres query: the list is reloaded every 30 seconds, results go to
 * ClickHouse in batches, and only state changes touch Postgres and alerts.
 *
 * One worker runs the checks. Running several would check twice; splitting
 * monitors between workers comes with the hosted version.
 */
export class UptimeScheduler {
  private readonly slots = new Map<string, Slot>()
  private rows: UptimeCheckRow[] = []
  private running = 0
  private lastHeartbeatAt = 0
  private online: { value: boolean; at: number } | null = null
  private readonly inflight = new Set<Promise<void>>()

  constructor(private readonly deps: UptimeDeps) {}

  /** Syncs the in-memory list with Postgres. New monitors start within their first interval. */
  async reload(): Promise<void> {
    const monitors = await this.deps.loadMonitors()
    const now = this.deps.now()
    const seen = new Set<string>()
    for (const monitor of monitors) {
      seen.add(monitor.id)
      const slot = this.slots.get(monitor.id)
      if (!slot) {
        this.slots.set(monitor.id, {
          monitor,
          status: monitor.status,
          // Spread the first checks over a few seconds instead of firing all at once.
          nextAt:
            now + Math.floor(Math.random() * Math.min(monitor.interval_seconds * 1000, 10_000)),
          failures: 0,
          running: false,
          lastDeepAt: 0,
          lastPing: null,
        })
        continue
      }
      const edited = slot.monitor.updated_at.getTime() !== monitor.updated_at.getTime()
      if (edited) {
        // A new URL or interval is checked at once; the failure count starts over.
        slot.nextAt = now
        slot.failures = 0
        slot.lastDeepAt = 0
        slot.status = monitor.status
      }
      slot.monitor = monitor
    }
    for (const id of this.slots.keys()) if (!seen.has(id)) this.slots.delete(id)
  }

  /** Starts the checks that are due. Heartbeats are compared with their last ping. */
  async tick(): Promise<void> {
    const now = this.deps.now()
    const limit = this.deps.concurrency ?? 20
    const heartbeats: Slot[] = []
    for (const slot of this.slots.values()) {
      if (slot.monitor.kind === 'heartbeat') {
        heartbeats.push(slot)
        continue
      }
      if (slot.running || slot.nextAt > now || this.running >= limit) continue
      this.track(this.runCheck(slot))
    }
    if (heartbeats.length > 0 && now - this.lastHeartbeatAt >= HEARTBEAT_EVERY_MS) {
      this.lastHeartbeatAt = now
      await this.checkHeartbeats(heartbeats)
    }
  }

  /** Writes the buffered results. A failed write keeps them for the next try. */
  async flush(): Promise<void> {
    if (this.rows.length === 0) return
    const batch = this.rows
    this.rows = []
    try {
      await this.deps.writeRows(batch)
    } catch (err) {
      this.deps.log.warn({ err, rows: batch.length }, 'uptime results not written, will retry')
      // Capped, so a long ClickHouse outage cannot exhaust memory; the oldest go first.
      this.rows = [...batch, ...this.rows].slice(-MAX_BUFFERED_ROWS)
    }
  }

  /** Waits for the checks in progress. */
  async drain(): Promise<void> {
    await Promise.all([...this.inflight])
  }

  get size() {
    return this.slots.size
  }

  private track(promise: Promise<void>) {
    this.inflight.add(promise)
    void promise.finally(() => this.inflight.delete(promise))
  }

  private async runCheck(slot: Slot) {
    const { monitor } = slot
    slot.running = true
    this.running++
    const started = this.deps.now()
    const deep = started - slot.lastDeepAt >= DEEP_EVERY_MS
    try {
      const result = await this.deps.check(monitor.url ?? '', {
        kind: monitor.kind === 'health' ? 'health' : 'site',
        deep,
        allowPrivate: this.deps.allowPrivate,
        timeoutMs: Math.min(15_000, monitor.interval_seconds * 500),
      })
      if (deep) slot.lastDeepAt = started
      const at = new Date(this.deps.now())
      this.rows.push({
        org_id: monitor.org_id,
        project_id: monitor.project_id,
        monitor_id: monitor.id,
        timestamp: toClickHouseTime(at),
        up: result.up ? 1 : 0,
        status_code: result.status,
        duration_ms: result.durationMs,
        error: result.error ?? (result.up ? '' : `HTTP ${result.status}`),
        cert_days: result.tls?.daysLeft ?? null,
      })
      if (result.up) {
        slot.failures = 0
        slot.nextAt = started + monitor.interval_seconds * 1000
        await this.transition(slot, 'up', at, null)
      } else {
        slot.failures++
        slot.nextAt = started + Math.min(RETRY_AFTER_FAILURE_MS, monitor.interval_seconds * 1000)
        if (
          slot.failures >= FAILURES_TO_DOWN &&
          slot.status !== 'down' &&
          (await this.isOnline())
        ) {
          await this.transition(slot, 'down', at, result.error ?? `HTTP ${result.status}`)
        }
      }
    } catch (err) {
      this.deps.log.error({ err, monitor: monitor.id }, 'uptime check crashed')
      slot.nextAt = started + monitor.interval_seconds * 1000
    } finally {
      slot.running = false
      this.running--
    }
  }

  private async checkHeartbeats(slots: Slot[]) {
    let pings: Map<string, number>
    try {
      pings = await this.deps.readPings(slots.map((slot) => slot.monitor.id))
    } catch (err) {
      // Without Valkey nothing can be said about heartbeats; do not call them down.
      this.deps.log.warn({ err }, 'heartbeat pings not readable')
      return
    }
    const now = this.deps.now()
    for (const slot of slots) {
      const { monitor } = slot
      const ping = pings.get(monitor.id) ?? null
      if (ping !== null && ping !== slot.lastPing) {
        slot.lastPing = ping
        this.rows.push(this.heartbeatRow(monitor, new Date(ping), true, ''))
      }
      const allowedMs = (monitor.interval_seconds + monitor.grace_seconds) * 1000
      // Until the first ping, the clock starts when the monitor was created or edited.
      const since = Math.max(ping ?? 0, monitor.updated_at.getTime())
      if (ping !== null && now - ping <= allowedMs) {
        await this.transition(slot, 'up', new Date(ping), null)
      } else if (now - since > allowedMs && slot.status !== 'down') {
        const minutes = Math.round((now - since) / 60_000)
        const reason = ping === null ? 'no ping yet' : `no ping for ${minutes} min`
        this.rows.push(this.heartbeatRow(monitor, new Date(now), false, reason))
        await this.transition(slot, 'down', new Date(now), reason)
      }
    }
  }

  /** Asks at most every 30 seconds, however many monitors fail at once. */
  private async isOnline(): Promise<boolean> {
    const now = this.deps.now()
    if (this.online && now - this.online.at < 30_000) return this.online.value
    const value = await this.deps.isOnline().catch(() => false)
    if (!value)
      this.deps.log.warn('this server cannot reach the internet; no monitor is called down')
    this.online = { value, at: now }
    return value
  }

  private heartbeatRow(
    monitor: ActiveMonitor,
    at: Date,
    up: boolean,
    error: string,
  ): UptimeCheckRow {
    return {
      org_id: monitor.org_id,
      project_id: monitor.project_id,
      monitor_id: monitor.id,
      timestamp: toClickHouseTime(at),
      up: up ? 1 : 0,
      status_code: null,
      duration_ms: null,
      error,
      cert_days: null,
    }
  }

  private async transition(slot: Slot, to: MonitorStatus, at: Date, reason: string | null) {
    const from = slot.status
    if (from === to) return
    slot.status = to
    let saved = false
    try {
      saved = await this.deps.setStatus(slot.monitor.id, from, to, at)
    } catch (err) {
      // Postgres is down: try again on the next check.
      slot.status = from
      this.deps.log.warn({ err, monitor: slot.monitor.id }, 'monitor status not saved')
      return
    }
    if (!saved) return
    this.deps.log.info({ monitor: slot.monitor.id, from, to, reason }, 'monitor state changed')
    try {
      await this.deps.onTransition({ monitor: slot.monitor, from, to, at, reason })
    } catch (err) {
      this.deps.log.error({ err, monitor: slot.monitor.id }, 'monitor transition not handled')
    }
  }
}

/** Runs the scheduler: reload every 30 s, tick every second, flush every 5 s. */
export function startUptime(scheduler: UptimeScheduler, log: Logger) {
  const safely = (name: string, fn: () => Promise<void>) => () => {
    fn().catch((err) => log.error({ err }, `uptime ${name} failed`))
  }
  const timers = [
    setInterval(
      safely('reload', () => scheduler.reload()),
      30_000,
    ),
    setInterval(
      safely('tick', () => scheduler.tick()),
      1_000,
    ),
    setInterval(
      safely('flush', () => scheduler.flush()),
      5_000,
    ),
  ]
  safely('reload', () => scheduler.reload())()
  return {
    async stop() {
      for (const timer of timers) clearInterval(timer)
      await scheduler.drain()
      await scheduler.flush()
    },
  }
}
