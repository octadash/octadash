import { decryptSecret, type Logger } from '@octadash/core'
import {
  type ActiveMonitor,
  type ChannelRow,
  claimPendingIncidents,
  closeStaleMonitorIncidents,
  compileLogQuery,
  type createClickHouse,
  type Db,
  errorRates,
  ignoredIssueIds,
  issueHeads,
  keyEventRates,
  latestCertDays,
  listActiveMonitors,
  listEnabledChannels,
  listKeyEvents,
  listLogSearches,
  listOpenIncidentKeys,
  listProjects,
  logMatches,
  markNotified,
  openIncident,
  type PendingIncident,
  parseLogQuery,
  recentErrorProducts,
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
  /** Compares each product's errors with its normal. */
  errors: 'alerts-errors',
  /** Looks for key events that stopped arriving. */
  usage: 'alerts-usage',
  /** Runs the saved Logs searches that have Alert on. */
  logs: 'alerts-logs',
} as const

/** The longest quiet spell a Log alert waits for before it closes, in minutes. */
const LONGEST_LOG_SILENCE = 60

/** The Error spike rule looks at this many minutes. */
export const SPIKE_WINDOW_MINUTES = 15

/** A spike: at least `events` errors and `times` the normal. */
export function isSpike(count: number, normal: number, params: Record<string, number>) {
  return count >= (params.events ?? 20) && count >= (params.times ?? 5) * normal
}

/** The longest silence the rule waits for; an event rarer than that at this hour never counts as stopped. */
const LONGEST_WAIT_MINUTES = 24 * 60

/**
 * Minutes of silence after which a key event counts as stopped: the time
 * `expected` of them normally take at this hour, and at least `silence`. Null
 * when the event is too rare at this hour to tell.
 */
export function stoppedAfter(normalPerHour: number, params: Record<string, number>) {
  if (normalPerHour <= 0) return null
  const wait = Math.max(params.silence ?? 30, ((params.expected ?? 5) / normalPerHour) * 60)
  return wait > LONGEST_WAIT_MINUTES ? null : Math.ceil(wait)
}

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

  /**
   * Opens an Error spike for each product whose errors in the last 15 minutes
   * reach its rule, and closes the ones back under it. Only products with a
   * recent error, or an open spike, are read.
   */
  async function checkErrorSpikes() {
    const at = now()
    const windowMs = SPIKE_WINDOW_MINUTES * 60_000
    const open = await listOpenIncidentKeys(deps.db, 'error_spike')
    const recent = await recentErrorProducts(deps.db, new Date(at.getTime() - windowMs))
    const products = new Map(recent.map((p) => [p.projectId, p]))
    for (const row of open) {
      products.set(row.project_id, { orgId: row.org_id, projectId: row.project_id })
    }
    if (products.size === 0) return
    const list = [...products.values()]
    const skip = await ignoredIssueIds(
      deps.db,
      list.map((p) => p.projectId),
    )
    const rates = await errorRates(deps.clickhouse, list, at, SPIKE_WINDOW_MINUTES, skip)
    const openKeys = new Set(open.map((row) => row.dedupe_key))
    const changed = new Set<string>()
    for (const rate of rates) {
      const key = `errors:${rate.projectId}:spike`
      const rule = await ruleFor(deps.db, rate.orgId, rate.projectId, 'error_spike')
      const spike = rule.level !== 'off' && isSpike(rate.count, rate.normal, rule.params)
      if (spike && !openKeys.has(key)) {
        const heads = await issueHeads(
          deps.db,
          rate.top.map((t) => t.issueId),
        )
        const incident = await openIncident(deps.db, {
          orgId: rate.orgId,
          projectId: rate.projectId,
          kind: 'error_spike',
          dedupeKey: key,
          data: {
            count: rate.count,
            normal: Math.round(rate.normal * 10) / 10,
            minutes: SPIKE_WINDOW_MINUTES,
            issues: rate.top.map((t) => {
              const head = heads.find((h) => h.id === t.issueId)
              return {
                id: t.issueId,
                count: t.count,
                type: head?.type ?? '',
                value: head?.value ?? '',
                culprit: head?.culprit ?? '',
              }
            }),
          },
          at,
        })
        if (incident) changed.add(rate.orgId)
      } else if (!spike && openKeys.has(key)) {
        if (await resolveIncident(deps.db, key, at)) changed.add(rate.orgId)
      }
    }
    if (changed.size > 0) {
      await wake()
      await tell(changed, 'incidents')
    }
  }

  /**
   * Opens "Key event stopped" for each key event silent longer than its rule
   * allows at this hour, and closes it when the next one arrives (not when the
   * hour turns quiet). An unmarked key event's emergency closes without a
   * message.
   */
  async function checkKeyEvents() {
    const at = now()
    const [keys, open] = await Promise.all([
      listKeyEvents(deps.db, null),
      listOpenIncidentKeys(deps.db, 'key_event_stopped'),
    ])
    const keyOf = (projectId: string, event: string) => `usage:${projectId}:${event}:stopped`
    const openByKey = new Map(open.map((row) => [row.dedupe_key, row]))
    const changed = new Set<string>()
    const marked = new Set(keys.map((k) => keyOf(k.projectId, k.event)))
    for (const row of open) {
      if (!marked.has(row.dedupe_key)) {
        await resolveIncident(deps.db, row.dedupe_key, at, { silent: true })
      }
    }
    if (keys.length === 0) return
    const rates = await keyEventRates(deps.clickhouse, keys, at)
    for (const rate of rates) {
      const key = keyOf(rate.projectId, rate.event)
      const incident = openByKey.get(key)
      if (incident) {
        if (rate.last && rate.last > new Date(incident.started_at)) {
          if (await resolveIncident(deps.db, key, at)) changed.add(rate.orgId)
        }
        continue
      }
      const rule = await ruleFor(deps.db, rate.orgId, rate.projectId, 'key_event_stopped')
      if (rule.level === 'off' || !rate.last) continue
      const wait = stoppedAfter(rate.normal, rule.params)
      const silent = (at.getTime() - rate.last.getTime()) / 60_000
      if (wait === null || silent < wait) continue
      const opened = await openIncident(deps.db, {
        orgId: rate.orgId,
        projectId: rate.projectId,
        kind: 'key_event_stopped',
        dedupeKey: key,
        data: {
          event: rate.event,
          last: rate.last.toISOString(),
          normal: Math.round(rate.normal * 10) / 10,
          minutes: wait,
        },
        at,
      })
      if (opened) changed.add(rate.orgId)
    }
    if (changed.size > 0) {
      await wake()
      await tell(changed, 'incidents')
    }
  }

  /**
   * Log alert: each saved search with Alert on runs over the lines since it was
   * turned on (at most the last hour). A product with a match in the quiet
   * spell (`silence` minutes) gets an emergency; it closes once the spell
   * passes with no match. A search deleted or switched off closes its
   * emergencies without a message.
   */
  async function checkLogAlerts() {
    const at = now()
    const [searches, open] = await Promise.all([
      listLogSearches(deps.db, null),
      listOpenIncidentKeys(deps.db, 'log_alert'),
    ])
    const keyOf = (searchId: string, projectId: string) => `logs:${searchId}:${projectId}`
    const live = new Set(searches.map((s) => s.id))
    const changed = new Set<string>()
    for (const row of open) {
      const searchId = row.dedupe_key.split(':')[1] ?? ''
      if (!live.has(searchId)) await resolveIncident(deps.db, row.dedupe_key, at, { silent: true })
    }
    const openKeys = new Set(open.map((row) => row.dedupe_key))
    const projectsByOrg = new Map<string, { id: string; slug: string }[]>()
    for (const search of searches) {
      let projects = projectsByOrg.get(search.orgId)
      if (!projects) {
        projects = (await listProjects(deps.db, search.orgId)).map((p) => ({
          id: p.id,
          slug: p.slug,
        }))
        projectsByOrg.set(search.orgId, projects)
      }
      const query = compileLogQuery(
        parseLogQuery(search.query),
        new Map(projects.map((p) => [p.slug, p.id])),
      )
      const hourAgo = new Date(at.getTime() - LONGEST_LOG_SILENCE * 60_000)
      const since = search.alertSince && search.alertSince > hourAgo ? search.alertSince : hourAgo
      const matches = await logMatches(
        deps.clickhouse,
        search.orgId,
        projects.map((p) => p.id),
        query,
        since,
        at,
      )
      const byProject = new Map(matches.map((m) => [m.projectId, m]))
      for (const project of projects) {
        const key = keyOf(search.id, project.id)
        const match = byProject.get(project.id)
        const rule = await ruleFor(deps.db, search.orgId, project.id, 'log_alert')
        const silence = Math.min(LONGEST_LOG_SILENCE, Math.max(1, rule.params.silence ?? 15))
        const recent = match && at.getTime() - match.last.getTime() < silence * 60_000
        if (openKeys.has(key)) {
          if (!recent && (await resolveIncident(deps.db, key, at))) changed.add(search.orgId)
          continue
        }
        if (!recent || rule.level === 'off') continue
        const opened = await openIncident(deps.db, {
          orgId: search.orgId,
          projectId: project.id,
          kind: 'log_alert',
          dedupeKey: key,
          data: {
            search: search.name,
            searchId: search.id,
            query: search.query,
            count: match.count,
            window: Math.max(1, Math.round((at.getTime() - since.getTime()) / 60_000)),
            minutes: silence,
            last: match.last.toISOString(),
          },
          at,
        })
        if (opened) changed.add(search.orgId)
      }
    }
    if (changed.size > 0) {
      await wake()
      await tell(changed, 'incidents')
    }
  }

  return { onTransition, notify, checkCerts, checkErrorSpikes, checkKeyEvents, checkLogAlerts }
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
  await boss.createQueue(ALERT_QUEUES.errors)
  await boss.schedule(ALERT_QUEUES.errors, '* * * * *')
  await boss.work(ALERT_QUEUES.errors, async () => {
    await alerts.checkErrorSpikes().catch((err) => log.warn({ err }, 'error spike check failed'))
  })
  await boss.createQueue(ALERT_QUEUES.usage)
  await boss.schedule(ALERT_QUEUES.usage, '* * * * *')
  await boss.work(ALERT_QUEUES.usage, async () => {
    await alerts.checkKeyEvents().catch((err) => log.warn({ err }, 'key event check failed'))
  })
  await boss.createQueue(ALERT_QUEUES.logs)
  await boss.schedule(ALERT_QUEUES.logs, '* * * * *')
  await boss.work(ALERT_QUEUES.logs, async () => {
    await alerts.checkLogAlerts().catch((err) => log.warn({ err }, 'log alert check failed'))
  })
}
