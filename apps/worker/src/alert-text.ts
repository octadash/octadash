import type { PendingIncident } from '@octadash/db'
import type { AlertMessage } from '@octadash/integrations'
import { type FailureKey, failureOf } from '@octadash/uptime/failure'

/**
 * The words of every alert, in each language a channel can be set to. Alerts
 * leave the panel, so they cannot use its message files; this is the worker's
 * own small dictionary. Times are relative ("for 7 min"): the reader's time
 * zone is unknown and the channel shows when the message arrived.
 */
export type AlertLocale = 'en' | 'pt-BR'

export function alertLocale(value: string): AlertLocale {
  return value === 'pt-BR' ? 'pt-BR' : 'en'
}

interface Words {
  down: (monitor: string) => string
  up: (monitor: string) => string
  missed: (monitor: string) => string
  cert: (monitor: string, days: number) => string
  certRenewed: (monitor: string) => string
  spike: (product: string, count: number, minutes: number) => string
  spikeNormal: (normal: number) => string
  spikeTop: (issue: string, count: number) => string
  spikeOver: (product: string) => string
  spikeLasted: (duration: string) => string
  stopped: (product: string, event: string) => string
  stoppedFor: (duration: string, normal: number) => string
  stoppedBack: (product: string, event: string) => string
  stoppedLasted: (duration: string) => string
  logAlert: (product: string, search: string) => string
  logAlertLines: (count: number, minutes: number) => string
  logAlertOver: (product: string, search: string) => string
  logAlertQuiet: (minutes: number) => string
  paymentsFailing: (product: string, percent: number) => string
  paymentsFailed: (failed: number, total: number, minutes: number) => string
  paymentsBack: (product: string) => string
  paymentsLasted: (duration: string) => string
  runaway: (product: string, times: number) => string
  runawaySpent: (spent: string, normal: string) => string
  runawayOver: (product: string) => string
  runawayLasted: (duration: string) => string
  downFor: (duration: string) => string
  wasDownFor: (duration: string) => string
  manyDown: (count: number) => string
  manyUp: (count: number) => string
  many: (count: number) => string
  manyResolved: (count: number) => string
  failure: Record<FailureKey, (values: Record<string, string>) => string>
  minutes: (n: number) => string
  hours: (h: number, m: number) => string
  days: (d: number, h: number) => string
}

const words: Record<AlertLocale, Words> = {
  en: {
    down: (m) => `${m} is down`,
    up: (m) => `${m} is back up`,
    missed: (m) => `${m} did not check in`,
    cert: (m, d) =>
      d <= 0
        ? `The certificate of ${m} has expired`
        : `The certificate of ${m} expires in ${d} days`,
    certRenewed: (m) => `The certificate of ${m} was renewed`,
    spike: (p, n, min) => `Error spike on ${p}: ${n} errors in ${min} min`,
    spikeNormal: (n) => `Normal for this time is about ${n}.`,
    spikeTop: (issue, n) => `Most: ${issue} (${n}).`,
    spikeOver: (p) => `Errors on ${p} are back to normal`,
    spikeLasted: (d) => `The spike lasted ${d}.`,
    stopped: (p, e) => `${e} stopped on ${p}`,
    stoppedFor: (d, n) => `None for ${d}; normal for this time is about ${n} an hour.`,
    stoppedBack: (p, e) => `${e} is arriving again on ${p}`,
    stoppedLasted: (d) => `It was missing for ${d}.`,
    logAlert: (p, s) => `Log alert on ${p}: ${s}`,
    logAlertLines: (n, m) => `${n} matching ${n === 1 ? 'line' : 'lines'} in the last ${m} min.`,
    logAlertOver: (p, s) => `${s} is quiet again on ${p}`,
    logAlertQuiet: (m) => `No matching line for ${m} min.`,
    paymentsFailing: (p, pct) => `Payments failing on ${p}: ${pct}% of charges`,
    paymentsFailed: (f, t, m) => `${f} of ${t} charges failed in the last ${m} min.`,
    paymentsBack: (p) => `Payments are going through again on ${p}`,
    paymentsLasted: (d) => `They failed for ${d}.`,
    runaway: (p, x) =>
      x > 0 ? `Cost runaway on ${p}: ${x}× its normal hour` : `Cost runaway on ${p}`,
    runawaySpent: (s, n) => `${s} spent in one hour; a normal hour is ${n}.`,
    runawayOver: (p) => `Spend is back to normal on ${p}`,
    runawayLasted: (d) => `It ran high for ${d}.`,
    downFor: (d) => `Down for ${d}.`,
    wasDownFor: (d) => `It was down for ${d}.`,
    manyDown: (n) => `${n} monitors are down`,
    manyUp: (n) => `${n} monitors are back up`,
    many: (n) => `${n} alerts`,
    manyResolved: (n) => `${n} alerts resolved`,
    failure: {
      timeout: () => 'Did not answer in time',
      refused: () => 'Connection refused',
      notFound: () => 'Domain not found',
      reset: () => 'Connection dropped',
      tls: (v) => `HTTPS error (${v.code})`,
      notHealth: () => 'Answered with a page, not a /health answer',
      http: (v) => `Answered HTTP ${v.status}`,
      noPingYet: () => 'No ping yet',
      noPingFor: (v) => `No ping for ${v.minutes} min`,
      private: () => 'Points to a private address',
      tooManyRedirects: () => 'Too many redirects',
      other: (v) => v.code ?? '',
    },
    minutes: (n) => `${n} min`,
    hours: (h, m) => (m ? `${h} h ${m} min` : `${h} h`),
    days: (d, h) => (h ? `${d} d ${h} h` : `${d} d`),
  },
  'pt-BR': {
    down: (m) => `${m} está fora do ar`,
    up: (m) => `${m} voltou`,
    missed: (m) => `${m} não deu sinal`,
    cert: (m, d) =>
      d <= 0 ? `O certificado de ${m} venceu` : `O certificado de ${m} vence em ${d} dias`,
    certRenewed: (m) => `O certificado de ${m} foi renovado`,
    spike: (p, n, min) => `Pico de erros em ${p}: ${n} erros em ${min} min`,
    spikeNormal: (n) => `O normal para este horário é cerca de ${n}.`,
    spikeTop: (issue, n) => `Mais frequente: ${issue} (${n}).`,
    spikeOver: (p) => `Os erros de ${p} voltaram ao normal`,
    spikeLasted: (d) => `O pico durou ${d}.`,
    stopped: (p, e) => `${e} parou em ${p}`,
    stoppedFor: (d, n) => `Nenhum há ${d}; o normal para este horário é cerca de ${n} por hora.`,
    stoppedBack: (p, e) => `${e} voltou a chegar em ${p}`,
    stoppedLasted: (d) => `Ficou sem chegar por ${d}.`,
    logAlert: (p, s) => `Alerta de log em ${p}: ${s}`,
    logAlertLines: (n, m) =>
      `${n} ${n === 1 ? 'linha encontrada' : 'linhas encontradas'} nos últimos ${m} min.`,
    logAlertOver: (p, s) => `${s} voltou ao silêncio em ${p}`,
    logAlertQuiet: (m) => `Nenhuma linha encontrada há ${m} min.`,
    paymentsFailing: (p, pct) => `Pagamentos falhando em ${p}: ${pct}% das cobranças`,
    paymentsFailed: (f, t, m) => `${f} de ${t} cobranças falharam nos últimos ${m} min.`,
    paymentsBack: (p) => `Os pagamentos voltaram a passar em ${p}`,
    paymentsLasted: (d) => `Falharam por ${d}.`,
    runaway: (p, x) =>
      x > 0 ? `Custo disparado em ${p}: ${x}× uma hora normal` : `Custo disparado em ${p}`,
    runawaySpent: (s, n) => `${s} gastos em uma hora; uma hora normal é ${n}.`,
    runawayOver: (p) => `O gasto voltou ao normal em ${p}`,
    runawayLasted: (d) => `Ficou alto por ${d}.`,
    downFor: (d) => `Fora do ar há ${d}.`,
    wasDownFor: (d) => `Ficou fora do ar por ${d}.`,
    manyDown: (n) => `${n} monitores fora do ar`,
    manyUp: (n) => `${n} monitores voltaram`,
    many: (n) => `${n} alertas`,
    manyResolved: (n) => `${n} alertas resolvidos`,
    failure: {
      timeout: () => 'Não respondeu a tempo',
      refused: () => 'Conexão recusada',
      notFound: () => 'Domínio não encontrado',
      reset: () => 'Conexão interrompida',
      tls: (v) => `Erro de HTTPS (${v.code})`,
      notHealth: () => 'Respondeu com uma página, não com uma resposta de /health',
      http: (v) => `Respondeu HTTP ${v.status}`,
      noPingYet: () => 'Nenhum ping ainda',
      noPingFor: (v) => `Sem ping há ${v.minutes} min`,
      private: () => 'Aponta para um endereço privado',
      tooManyRedirects: () => 'Redirecionamentos demais',
      other: (v) => v.code ?? '',
    },
    minutes: (n) => `${n} min`,
    hours: (h, m) => (m ? `${h} h ${m} min` : `${h} h`),
    days: (d, h) => (h ? `${d} d ${h} h` : `${d} d`),
  },
}

export function duration(ms: number, locale: AlertLocale): string {
  const w = words[locale]
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return w.minutes(minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return w.hours(hours, minutes % 60)
  return w.days(Math.floor(hours / 24), hours % 24)
}

interface IncidentData {
  name?: string
  url?: string | null
  reason?: string | null
  days?: number
  /** Error spike: events in the window, the normal and the top issues. */
  count?: number
  normal?: number
  minutes?: number
  issues?: { type?: string; value?: string; count?: number }[]
  /** Key event stopped: the event, when it last came and its normal per hour. */
  event?: string
  last?: string
  /** Log alert: the saved search's name and the minutes its count covers. */
  search?: string
  window?: number
  /** Payments failing: charges in the window and how many failed. */
  failed?: number
  total?: number
  percent?: number
  /** Cost runaway: cents spent in the hour, its multiple of normal, and the hour. */
  spent?: number
  times?: number
  hour?: string
}

export type AlertEvent = 'open' | 'resolve'

/** One incident as one line: the title, and what happened. */
function describe(incident: PendingIncident, event: AlertEvent, now: Date, locale: AlertLocale) {
  const w = words[locale]
  const data = (incident.data ?? {}) as IncidentData
  const name = data.name ?? incident.project_name
  const started = new Date(incident.started_at).getTime()
  const ended = incident.resolved_at ? new Date(incident.resolved_at).getTime() : now.getTime()
  const reason = data.reason ? failureText(data.reason, locale) : null

  if (incident.kind === 'error_spike') {
    if (event === 'resolve') {
      return {
        title: w.spikeOver(incident.project_name),
        detail: w.spikeLasted(duration(ended - started, locale)),
      }
    }
    const top = data.issues?.[0]
    const issue = top ? [top.type, top.value].filter(Boolean).join(': ').slice(0, 120) : ''
    return {
      title: w.spike(incident.project_name, data.count ?? 0, data.minutes ?? 15),
      detail: [
        w.spikeNormal(Math.round(data.normal ?? 0)),
        issue ? w.spikeTop(issue, top?.count ?? 0) : '',
      ]
        .filter(Boolean)
        .join(' '),
    }
  }
  if (incident.kind === 'key_event_stopped') {
    const key = data.event ?? ''
    const last = data.last ? new Date(data.last).getTime() : started
    if (event === 'resolve') {
      return {
        title: w.stoppedBack(incident.project_name, key),
        detail: w.stoppedLasted(duration(ended - last, locale)),
      }
    }
    const normal = data.normal ?? 0
    return {
      title: w.stopped(incident.project_name, key),
      detail: w.stoppedFor(
        duration(now.getTime() - last, locale),
        normal >= 10 ? Math.round(normal) : Math.round(normal * 10) / 10,
      ),
    }
  }
  if (incident.kind === 'log_alert') {
    const search = data.search ?? ''
    return event === 'resolve'
      ? {
          title: w.logAlertOver(incident.project_name, search),
          detail: w.logAlertQuiet(data.minutes ?? 15),
        }
      : {
          title: w.logAlert(incident.project_name, search),
          detail: w.logAlertLines(data.count ?? 1, data.window ?? 60),
        }
  }
  if (incident.kind === 'payments_failing') {
    return event === 'resolve'
      ? {
          title: w.paymentsBack(incident.project_name),
          detail: w.paymentsLasted(duration(ended - started, locale)),
        }
      : {
          title: w.paymentsFailing(incident.project_name, data.percent ?? 0),
          detail: w.paymentsFailed(data.failed ?? 0, data.total ?? 0, data.minutes ?? 15),
        }
  }
  if (incident.kind === 'cost_runaway') {
    const usd = (cents: number) =>
      new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(cents / 100)
    return event === 'resolve'
      ? {
          title: w.runawayOver(incident.project_name),
          detail: w.runawayLasted(duration(ended - started, locale)),
        }
      : {
          title: w.runaway(incident.project_name, data.times ?? 0),
          detail: w.runawaySpent(usd(data.spent ?? 0), usd(data.normal ?? 0)),
        }
  }
  if (incident.kind === 'cert_expiring') {
    return event === 'open'
      ? { title: w.cert(name, data.days ?? 0), detail: data.url ?? '' }
      : { title: w.certRenewed(name), detail: data.url ?? '' }
  }
  if (event === 'resolve') {
    return { title: w.up(name), detail: w.wasDownFor(duration(ended - started, locale)) }
  }
  const title = incident.kind === 'heartbeat_missed' ? w.missed(name) : w.down(name)
  const since = w.downFor(duration(now.getTime() - started, locale))
  return { title, detail: [reason ? `${reason}.` : '', since].filter(Boolean).join(' ') }
}

export function failureText(code: string, locale: AlertLocale): string {
  const failure = failureOf(code)
  return words[locale].failure[failure.key](failure.values ?? {})
}

/**
 * The message a channel gets for one or several incidents of the same event.
 * Ten products down at once (a provider outage) arrive as one message listing
 * them, not ten.
 */
export function alertMessage(
  incidents: PendingIncident[],
  event: AlertEvent,
  options: { now: Date; locale: AlertLocale; panelUrl: string },
): AlertMessage {
  const { now, locale, panelUrl } = options
  const w = words[locale]
  const base = panelUrl.replace(/\/+$/, '')
  const [first] = incidents
  if (!first) throw new Error('alertMessage needs at least one incident')
  const severity = event === 'open' ? 'critical' : 'resolved'

  if (incidents.length === 1) {
    const line = describe(first, event, now, locale)
    return {
      severity,
      title: line.title,
      body: line.detail,
      project: { id: first.project_id, name: first.project_name },
      url:
        first.kind === 'error_spike' ||
        first.kind === 'key_event_stopped' ||
        first.kind === 'log_alert' ||
        first.kind === 'payments_failing' ||
        first.kind === 'cost_runaway'
          ? `${base}/p/${first.project_slug}/emergencies/${first.id}`
          : `${base}/p/${first.project_slug}/uptime`,
      occurredAt: now,
    }
  }

  const monitorsOnly = incidents.every(
    (i) => i.kind === 'monitor_down' || i.kind === 'heartbeat_missed',
  )
  const title = monitorsOnly
    ? event === 'open'
      ? w.manyDown(incidents.length)
      : w.manyUp(incidents.length)
    : event === 'open'
      ? w.many(incidents.length)
      : w.manyResolved(incidents.length)
  const lines = incidents.map((incident) => {
    const line = describe(incident, event, now, locale)
    const title =
      incident.kind === 'error_spike' ||
      incident.kind === 'key_event_stopped' ||
      incident.kind === 'log_alert' ||
      incident.kind === 'payments_failing' ||
      incident.kind === 'cost_runaway'
        ? line.title
        : `${incident.project_name}: ${line.title}`
    return `• ${title}. ${line.detail}`.trim()
  })
  return {
    severity,
    title,
    body: lines.join('\n'),
    url: monitorsOnly ? `${base}/all/uptime` : `${base}/all`,
    occurredAt: now,
  }
}
