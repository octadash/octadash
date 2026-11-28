import { Cron } from 'croner'

/**
 * When a heartbeat is due and whether it is late. A heartbeat expects a call
 * from a job (backup, cron, worker) either every N seconds or on a cron
 * schedule read in the organization's time zone, plus a grace for jobs that
 * run long. A job can also report failure at once by calling `/fail`.
 */

export interface HeartbeatPlan {
  intervalSeconds: number
  /** Five-field cron ("0 3 * * *"). Null: every `intervalSeconds`. */
  schedule: string | null
  graceSeconds: number
  /** IANA zone the schedule is read in. */
  timeZone: string
}

export type HeartbeatState =
  /** Called on time. */
  | { state: 'up' }
  /** Not called yet, and not due yet. */
  | { state: 'waiting'; due: Date }
  /** Due plus grace passed without a call. */
  | { state: 'late'; due: Date; firstCall: boolean }
  /** The job called /fail after its last good call. */
  | { state: 'failed'; at: Date }

/** True for a five-field cron expression Octadash can read. */
export function isValidSchedule(expression: string, timeZone = 'UTC'): boolean {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return false
  try {
    return new Cron(expression, { timezone: timeZone, paused: true }).nextRun() !== null
  } catch {
    return false
  }
}

/** The first moment a call is expected after `after`. */
export function nextDue(plan: HeartbeatPlan, after: Date): Date {
  if (plan.schedule) {
    try {
      const next = new Cron(plan.schedule, { timezone: plan.timeZone, paused: true }).nextRun(after)
      if (next) return next
    } catch {
      // A schedule that no longer parses falls back to the interval.
    }
  }
  return new Date(after.getTime() + plan.intervalSeconds * 1000)
}

/**
 * Judges a heartbeat now. `since` is when watching started (created or last
 * edited), so a new monitor is not late before its first due time.
 */
export function judgeHeartbeat(
  plan: HeartbeatPlan,
  calls: { lastCall: Date | null; lastFail: Date | null; since: Date },
  now: Date,
): HeartbeatState {
  const lastCall = calls.lastCall?.getTime() ?? 0
  if (calls.lastFail && calls.lastFail.getTime() > lastCall) {
    return { state: 'failed', at: calls.lastFail }
  }
  const base = new Date(Math.max(lastCall, calls.since.getTime()))
  const due = nextDue(plan, base)
  if (now.getTime() > due.getTime() + plan.graceSeconds * 1000) {
    return { state: 'late', due, firstCall: calls.lastCall === null }
  }
  return calls.lastCall ? { state: 'up' } : { state: 'waiting', due }
}
