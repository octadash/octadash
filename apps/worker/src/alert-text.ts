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
      url: `${base}/p/${first.project_slug}/uptime`,
      occurredAt: now,
    }
  }

  const monitorsOnly = incidents.every((i) => i.kind !== 'cert_expiring')
  const title = monitorsOnly
    ? event === 'open'
      ? w.manyDown(incidents.length)
      : w.manyUp(incidents.length)
    : event === 'open'
      ? w.many(incidents.length)
      : w.manyResolved(incidents.length)
  const lines = incidents.map((incident) => {
    const line = describe(incident, event, now, locale)
    return `• ${incident.project_name}: ${line.title}. ${line.detail}`.trim()
  })
  return {
    severity,
    title,
    body: lines.join('\n'),
    url: `${base}/all/uptime`,
    occurredAt: now,
  }
}
