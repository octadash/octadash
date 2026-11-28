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
  fetch?: typeof fetch
  now?: () => Date
}

export function createAlerts(deps: AlertsDeps) {
  const now = deps.now ?? (() => new Date())
  const fetchFn = deps.fetch ?? fetch

  async function wake(at?: Date) {
    await deps.boss.send(ALERT_QUEUES.notify, null, at && at > now() ? { startAfter: at } : {})
  }

  /** The uptime scheduler calls this on every state change it saved. */
  async function onTransition({ monitor, to, at, reason }: Transition) {
    const dedupeKey = `monitor:${monitor.id}:down`
    if (to === 'down') {
      const incident = await openIncident(deps.db, {
        orgId: monitor.org_id,
        projectId: monitor.project_id,
        monitorId: monitor.id,
        kind: monitor.kind === 'heartbeat' ? 'heartbeat_missed' : 'monitor_down',
        dedupeKey,
        data: { name: monitor.name, url: monitor.url, reason },
        at,
      })
      if (incident) await wake(incident.notify_after)
    } else if (to === 'up') {
      if (await resolveIncident(deps.db, dedupeKey, at)) await wake()
    }
  }

  /** Sends every message that is due, one per channel and event. */
  async function notify() {
    const at = now()
    await closeStaleMonitorIncidents(deps.db, at)
    await deps.db.transaction().execute(async (trx) => {
      const pending = await claimPendingIncidents(trx, at)
      if (pending.length === 0) return
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
    let changed = false
    for (const monitor of monitors) {
      const left = days.get(monitor.id)
      if (left === undefined) continue
      const key = `monitor:${monitor.id}:cert`
      const rule = await ruleFor(deps.db, monitor.org_id, monitor.project_id, 'cert_expiring')
      const limit = rule.params.days ?? 7
      if (left <= limit && !open.has(key)) {
        changed ||= Boolean(await openCert(monitor, key, left, at))
      } else if (left > limit && open.has(key)) {
        changed ||= Boolean(await resolveIncident(deps.db, key, at))
      }
    }
    if (changed) await wake()
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
