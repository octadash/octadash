import { getWatcher, listMembers, listOpenIncidents, listResolvedSince } from '@octadash/db'
import { getTranslations } from 'next-intl/server'
import type { StripData, StripItem, StripKind } from '@/lib/emergency-strip'
import { RESOLVED_SHOW_MS } from '@/lib/emergency-strip'
import { describeFailure } from '@/lib/monitors'
import { storageState } from '@/lib/storage'
import { statusCodeOf } from '@/lib/uptime-board'
import { services } from './context'
import { readStorageStatus } from './live'

const KINDS: StripKind[] = [
  'monitor_down',
  'heartbeat_missed',
  'cert_expiring',
  'error_spike',
  'key_event_stopped',
  'log_alert',
  'payments_failing',
  'cost_runaway',
]

/**
 * Every open emergency of the organization, whatever the product picker
 * shows, plus the ones that just ended. Signals never reach the strip.
 */
export async function loadStrip(
  orgId: string,
  userId: string,
  canManage: boolean,
  now = new Date(),
  /** TV mode shows signals too, on their products' tiles. */
  withSignals = false,
): Promise<StripData> {
  const { db } = services()
  const [open, ended, members, watcher, storage, t, tu, te] = await Promise.all([
    listOpenIncidents(db, orgId),
    listResolvedSince(db, orgId, new Date(now.getTime() - RESOLVED_SHOW_MS)),
    listMembers(db, orgId),
    canManage ? getWatcher(db) : Promise.resolve(undefined),
    canManage ? readStorageStatus() : Promise.resolve(null),
    getTranslations('strip'),
    getTranslations('uptime'),
    getTranslations('emergency'),
  ])
  const nameOf = (id: string | null) =>
    id ? (members.find((m) => m.userId === id)?.name ?? '?') : null
  const readable = (reason: string) => {
    const code = statusCodeOf(reason)
    return code
      ? te('httpStatus', { code })
      : describeFailure(reason, (key, values) => tu(`failure.${key}`, values))
  }

  const items: StripItem[] = open
    .filter((i) => i.level === 'emergency' || (withSignals && i.level === 'signal'))
    .map((incident) => {
      const data = (incident.data ?? {}) as Record<string, unknown>
      const kind = (KINDS as string[]).includes(incident.kind)
        ? (incident.kind as StripKind)
        : 'other'
      const name = typeof data.name === 'string' ? data.name : ''
      const reason = typeof data.reason === 'string' && data.reason ? readable(data.reason) : ''
      const days = typeof data.days === 'number' ? data.days : 0
      const values = {
        product: incident.project_name,
        name,
        days,
        reason,
        count: typeof data.count === 'number' ? data.count : 0,
        minutes: typeof data.minutes === 'number' ? data.minutes : 15,
        normal: roundNormal(typeof data.normal === 'number' ? data.normal : 0, kind),
        event: typeof data.event === 'string' ? data.event : '',
        search: typeof data.search === 'string' ? data.search : '',
        percent: typeof data.percent === 'number' ? data.percent : 0,
        failed: typeof data.failed === 'number' ? data.failed : 0,
        total: typeof data.total === 'number' ? data.total : 0,
        times: typeof data.times === 'number' ? data.times : 0,
        spent: `US$ ${((typeof data.spent === 'number' ? data.spent : 0) / 100).toFixed(2)}`,
      }
      const checked = data.checked as { controls?: { target: string; ms: number | null }[] }
      return {
        id: incident.id,
        href: `/p/${incident.project_slug}/emergencies/${incident.id}`,
        projectId: incident.project_id,
        product: incident.project_name,
        signal: incident.level !== 'emergency',
        kind,
        title: t(`title.${kind}`, values),
        short: t(`short.${kind}`, values),
        detail: t(reason ? `detail.${kind}` : `detailNoReason.${kind}`, values),
        startedAt: incident.started_at.getTime(),
        showAt: incident.notify_after.getTime(),
        taker: incident.acknowledged_by
          ? {
              id: incident.acknowledged_by,
              name: nameOf(incident.acknowledged_by) ?? '?',
              at: (incident.acknowledged_at ?? incident.started_at).getTime(),
            }
          : null,
        ip: typeof data.ip === 'string' ? data.ip : null,
        controls: (checked?.controls ?? []).map((c) => ({ target: c.target, ok: c.ms !== null })),
      }
    })

  // A blip that ended before its wait never showed: nothing to turn green.
  const resolved = ended
    .filter((incident) => (incident.resolved_at as Date) >= incident.notify_after)
    .map((incident) => {
      const data = (incident.data ?? {}) as Record<string, unknown>
      const closer = nameOf(incident.closed_by)
      const resolvedAt = (incident.resolved_at as Date).getTime()
      return {
        id: incident.id,
        href: `/p/${incident.project_slug}/emergencies/${incident.id}`,
        title: closer
          ? t('closedBy', { product: incident.project_name, name: closer })
          : t(
              incident.kind === 'cert_expiring'
                ? 'renewed'
                : incident.kind === 'error_spike'
                  ? 'spikeOver'
                  : incident.kind === 'key_event_stopped'
                    ? 'keyBack'
                    : incident.kind === 'log_alert'
                      ? 'logQuiet'
                      : incident.kind === 'payments_failing'
                        ? 'paymentsBack'
                        : incident.kind === 'cost_runaway'
                          ? 'runawayOver'
                          : 'back',
              {
                product: incident.project_name,
                name: typeof data.name === 'string' ? data.name : '',
                event: typeof data.event === 'string' ? data.event : '',
                search: typeof data.search === 'string' ? data.search : '',
              },
            ),
        lastedMs: resolvedAt - incident.started_at.getTime(),
        taker: nameOf(incident.acknowledged_by),
        resolvedAt,
      }
    })

  return {
    me: userId,
    serverNow: now.getTime(),
    items,
    resolved,
    watcherFailing: watcher?.watcher_status === 'failing' && !!watcher.watcher_url,
    storageFailing: storageState(storage, now.getTime()) === 'failing',
  }
}

/** Errors per window read as whole numbers; a key event's normal per hour can be 0.4. */
function roundNormal(normal: number, kind: StripKind) {
  return kind === 'key_event_stopped' && normal < 10
    ? Math.round(normal * 10) / 10
    : Math.round(normal)
}
