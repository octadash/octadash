import { decryptSecret, type Logger } from '@octadash/core'
import {
  type ActiveMonitor,
  type ChannelRow,
  claimPendingIncidents,
  closeStaleMonitorIncidents,
  type createClickHouse,
  type Db,
  latestCertDays,
  listActiveMonitors,
  listEnabledChannels,
  listOpenIncidentKeys,
  markNotified,
  openIncident,
  type PendingIncident,
  recordNotification,
  resolveIncident,
  ruleFor,
} from '@octadash/db'
import { builtinIntegrations, type NotificationIntegration } from '@octadash/integrations'
import type { LivePublisher, LiveTopic } from '@octadash/queue'
import type { PgBoss } from 'pg-boss'
import { type AlertEvent, alertLocale, alertMessage } from './alert-text'
import type { Transition } from './uptime'

export const ALERT_QUEUES = {
  /** Sends what is due. Woken when an incident opens or closes, and every minute as a safety net. */
  notify: 'alerts-notify',
  /** Reads certificate expiry from the last checks. */
  certs: 'alerts-certs',
} as const

const SEND_TIMEOUT_MS = 15_000

const notifiers = new Map(
  builtinIntegrations
    .filter((i): i is NotificationIntegration => i.kind === 'notification')
    .map((i) => [i.id, i]),
)

export interface Delivery {
  channel: ChannelRow
  event: AlertEvent
  incidents: PendingIncident[]
}

/**
 * Who gets what: each incident goes to the channels its rule names, or to every
 * enabled channel of its organization when the rule names none. Incidents for
 * the same channel and event become one delivery, so an outage that takes ten
 * products down is one message per channel.
 */
export function planDeliveries(incidents: PendingIncident[], channels: ChannelRow[]): Delivery[] {
  const byKey = new Map<string, Delivery>()
  for (const incident of incidents) {
    const event: AlertEvent = incident.resolved_at ? 'resolve' : 'open'
    const targets = channels.filter(
      (channel) =>
        channel.org_id === incident.org_id &&
        (incident.channel_ids === null || incident.channel_ids.includes(channel.id)),
    )
    for (const channel of targets) {
      const key = `${channel.id}:${event}`
      const delivery = byKey.get(key) ?? { channel, event, incidents: [] }
      delivery.incidents.push(incident)
      byKey.set(key, delivery)
    }
  }
  return [...byKey.values()]
}

/** The channel's settings with its secrets decrypted, ready for the integration. */
export function channelConfig(channel: ChannelRow, secret: string): Record<string, unknown> {
  const config = { ...((channel.config as Record<string, unknown>) ?? {}) }
  for (const [key, value] of Object.entries((channel.secrets as Record<string, string>) ?? {})) {
    config[key] = decryptSecret(value, secret)
  }
  return config
}

export interface AlertsDeps {
  db: Db
  clickhouse: ReturnType<typeof createClickHouse>
  boss: PgBoss
  secret: string
  panelUrl: string
  log: Logger
  /** Tells open screens that incidents or monitors changed. */
  live?: LivePublisher
  fetch?: typeof fetch
  now?: () => Date
  /**
   * Looks around when a site or API goes down (DNS, certificate, control
   * addresses), so the emergency page can say what Octadash ruled out.
   */
  diagnose?: (transition: Transition) => Promise<Record<string, unknown> | null>
}

export function createAlerts(deps: AlertsDeps) {
  const now = deps.now ?? (() => new Date())
  const fetchFn = deps.fetch ?? fetch

  async function wake(at?: Date) {
    await deps.boss.send(ALERT_QUEUES.notify, null, at && at > now() ? { startAfter: at } : {})
  }

  /** A screen that misses an update catches up on its next load; never fail the job for it. */
  async function tell(orgIds: Iterable<string>, topic: LiveTopic) {
    if (!deps.live) return
    const live = deps.live
    await Promise.all(
      [...new Set(orgIds)].map((orgId) =>
        live.publish(orgId, topic).catch((err: unknown) => {
          deps.log.warn({ err: err instanceof Error ? err.message : err }, 'live update lost')
        }),
      ),
    )
  }

  /** The uptime scheduler calls this on every state change it saved. */
  async function onTransition(transition: Transition) {
    const { monitor, to, at, reason, ip } = transition
    const dedupeKey = `monitor:${monitor.id}:down`
    if (to === 'down') {
      const checked =
        monitor.kind === 'heartbeat' || !deps.diagnose
          ? null
          : await deps.diagnose(transition).catch((err: unknown) => {
              deps.log.warn({ err, monitor: monitor.id }, 'diagnosis failed')
              return null
            })
      const incident = await openIncident(deps.db, {
        orgId: monitor.org_id,
        projectId: monitor.project_id,
        monitorId: monitor.id,
        kind: monitor.kind === 'heartbeat' ? 'heartbeat_missed' : 'monitor_down',
        dedupeKey,
        data: {
          name: monitor.name,
          url: monitor.url,
          reason,
          ip: ip ?? null,
          status: transition.status ?? null,
          ...(checked ? { checked } : {}),
        },
        at,
      })
      if (incident) {
        await wake(incident.notify_after)
        await tell([monitor.org_id], 'incidents')
      }
    } else if (to === 'up') {
      if (await resolveIncident(deps.db, dedupeKey, at)) {
        await wake()
        await tell([monitor.org_id], 'incidents')
      }
    }
    await tell([monitor.org_id], 'monitors')
  }

  /** Sends every message that is due, one per channel and event. */
  async function notify() {
    const at = now()
    const changed = new Set(await closeStaleMonitorIncidents(deps.db, at))
    await deps.db.transaction().execute(async (trx) => {
      const pending = await claimPendingIncidents(trx, at)
      if (pending.length === 0) return
      for (const incident of pending) changed.add(incident.org_id)
      const orgIds = [...new Set(pending.map((incident) => incident.org_id))]
      const channels = await listEnabledChannels(trx, orgIds)
      const deliveries = planDeliveries(pending, channels)
      await Promise.all(deliveries.map((delivery) => send(trx, delivery, at)))
      // Marked even when a channel failed: retrying would repeat the message on
      // the channels that worked. The failure shows on the channel's settings.
      const opened = pending.filter((i) => !i.resolved_at).map((i) => i.id)
      const resolved = pending.filter((i) => i.resolved_at).map((i) => i.id)
      await markNotified(trx, opened, 'open', at)
      await markNotified(trx, resolved, 'resolve', at)
    })
    // After the commit, so a screen that reloads sees what changed.
    await tell(changed, 'incidents')
  }

  async function send(db: Db, { channel, event, incidents }: Delivery, at: Date) {
    const integration = notifiers.get(channel.integration)
    let error: string | null = null
    try {
      if (!integration) throw new Error(`unknown integration ${channel.integration}`)
      const config = integration.config.parse(channelConfig(channel, deps.secret))
      const message = alertMessage(incidents, event, {
        now: at,
        locale: alertLocale(channel.locale),
        panelUrl: deps.panelUrl,
      })
      await integration.send(message, config, {
        fetch: fetchFn,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      deps.log.warn({ channel: channel.id, error }, 'alert not delivered')
    }
    await recordNotification(db, {
      orgId: channel.org_id,
      channelId: channel.id,
      incidentIds: incidents.map((incident) => incident.id),
      event,
      ok: error === null,
      error,
    })
  }

  /** Opens an incident for each certificate inside its rule's window, and closes renewed ones. */
  async function checkCerts() {
    const monitors = (await listActiveMonitors(deps.db)).filter(
      (monitor) => monitor.kind !== 'heartbeat' && monitor.url?.startsWith('https:'),
    )
    if (monitors.length === 0) return
    const days = await latestCertDays(
      deps.clickhouse,
      monitors.map((monitor) => monitor.id),
    )
    const open = new Set(
      (await listOpenIncidentKeys(deps.db, 'cert_expiring')).map((row) => row.dedupe_key),
    )
    const at = now()
    const changed = new Set<string>()
    for (const monitor of monitors) {
      const left = days.get(monitor.id)
      if (left === undefined) continue
      const key = `monitor:${monitor.id}:cert`
      const rule = await ruleFor(deps.db, monitor.org_id, monitor.project_id, 'cert_expiring')
      const limit = rule.params.days ?? 7
      if (left <= limit && !open.has(key)) {
        if (await openCert(monitor, key, left, at)) changed.add(monitor.org_id)
      } else if (left > limit && open.has(key)) {
        if (await resolveIncident(deps.db, key, at)) changed.add(monitor.org_id)
      }
    }
    if (changed.size > 0) {
      await wake()
      await tell(changed, 'incidents')
    }
  }

  function openCert(monitor: ActiveMonitor, dedupeKey: string, days: number, at: Date) {
    return openIncident(deps.db, {
      orgId: monitor.org_id,
      projectId: monitor.project_id,
      monitorId: monitor.id,
      kind: 'cert_expiring',
      dedupeKey,
      data: { name: monitor.name, url: monitor.url, days },
      at,
    })
  }

  return { onTransition, notify, checkCerts }
}

export type Alerts = ReturnType<typeof createAlerts>

export async function registerAlertJobs(boss: PgBoss, alerts: Alerts, log: Logger) {
  await boss.createQueue(ALERT_QUEUES.notify)
  await boss.schedule(ALERT_QUEUES.notify, '* * * * *')
  await boss.work(ALERT_QUEUES.notify, async () => {
    await alerts.notify()
  })
  await boss.createQueue(ALERT_QUEUES.certs)
  await boss.schedule(ALERT_QUEUES.certs, '41 * * * *')
  await boss.work(ALERT_QUEUES.certs, async () => {
    await alerts.checkCerts().catch((err) => log.warn({ err }, 'certificate check failed'))
  })
}
