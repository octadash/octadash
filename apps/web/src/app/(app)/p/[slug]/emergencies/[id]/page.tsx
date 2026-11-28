import { getOrganizationSettings } from '@octadash/db'
import { CheckIcon, CircleIcon, DiamondIcon, TriangleIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { EmergencyChart } from '@/components/emergency-chart'
import { CloseDialog, NoteForm, SameTimeForm, TakeButton } from '@/components/emergency-controls'
import { InfoTip } from '@/components/info-tip'
import { Badge } from '@/components/ui/badge'
import { issueTitle } from '@/lib/errors'
import { describeFailure } from '@/lib/monitors'
import { statusCodeOf } from '@/lib/uptime-board'
import { cn } from '@/lib/utils'
import { services } from '@/server/context'
import { loadEmergency, type TimelineEntry } from '@/server/emergency'
import { requireOrg } from '@/server/session'
import { duration } from '@/views/overview-parts'

const KINDS = [
  'monitor_down',
  'heartbeat_missed',
  'cert_expiring',
  'error_spike',
  'key_event_stopped',
  'log_alert',
] as const

const AREA_OF: Record<Kind | 'other', string> = {
  monitor_down: 'uptime',
  heartbeat_missed: 'uptime',
  cert_expiring: 'uptime',
  error_spike: 'errors',
  key_event_stopped: 'usage',
  log_alert: 'logs',
  other: 'other',
}
type Kind = (typeof KINDS)[number]

/** An issue named on an Error spike, as the worker saved it. */
interface SpikeIssue {
  id: string
  count: number
  type: string
  value: string
  culprit: string
}

/**
 * One emergency, as closed in the Uptime canvas (frame 4). On top: what, since
 * when and who is on it, live. The chart of the monitor's checks around it,
 * then "What happened", the record everyone writes to. On the side: what
 * Octadash checked to rule out its own network, the other emergencies open at
 * the same time (same address shown as a hint, never merged), and the last
 * time this happened.
 */
export default async function EmergencyPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const { org, user } = await requireOrg()
  const now = new Date()
  const [emergency, settings, t, tu, common, locale] = await Promise.all([
    loadEmergency(org.id, id, now),
    getOrganizationSettings(services().db, org.id),
    getTranslations('emergency'),
    getTranslations('uptime'),
    getTranslations('common'),
    getLocale(),
  ])
  if (!emergency || emergency.incident.project_slug !== slug) notFound()
  const { incident, data, checked } = emergency
  const timeZone = settings.timeZone
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone })
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone })
  const open = incident.resolved_at === null
  const name = typeof data.name === 'string' ? data.name : (incident.monitor_name ?? '')
  const reason = typeof data.reason === 'string' ? data.reason : null
  const readable = (r: string) =>
    statusCodeOf(r)
      ? t('httpStatus', { code: statusCodeOf(r) as string })
      : describeFailure(r, (key, values) => tu(`failure.${key}`, values))
  const lasted = duration(locale, (incident.resolved_at ?? now).getTime() - +incident.started_at)
  const mine = incident.acknowledged_by === user.id
  const kind = KINDS.includes(incident.kind as Kind) ? (incident.kind as Kind) : 'other'
  const spike = {
    count: typeof data.count === 'number' ? data.count : 0,
    minutes: typeof data.minutes === 'number' ? data.minutes : 15,
    normal: Math.round(typeof data.normal === 'number' ? data.normal : 0),
    issues: Array.isArray(data.issues) ? (data.issues as SpikeIssue[]) : [],
  }
  const title = t(open ? `titles.${kind}` : `titlesOver.${kind}`, {
    product: incident.project_name,
    name,
    days: typeof data.days === 'number' ? data.days : 0,
    event: typeof data.event === 'string' ? data.event : '',
    search: typeof data.search === 'string' ? data.search : '',
  })
  const words = { ok: t('checked.ok'), fail: t('checked.fail') }
  const failureAt = emergency.timeline.find((e) => e.kind === 'firstFailure')?.at ?? null

  const summary = !open
    ? t('summary.closed', { time: time.format(incident.resolved_at as Date), duration: lasted })
    : kind === 'monitor_down' && reason
      ? t('summary.down', {
          reason: readable(reason),
          count: emergency.failures ?? 3,
        })
      : kind === 'heartbeat_missed'
        ? t('summary.heartbeat', { reason: reason ? readable(reason) : '' })
        : kind === 'error_spike'
          ? t(spike.normal > 0 ? 'summary.spike' : 'summary.spikeNone', {
              count: spike.count,
              minutes: spike.minutes,
              normal: spike.normal,
            })
          : kind === 'key_event_stopped'
            ? t('summary.keyEvent', {
                event: typeof data.event === 'string' ? data.event : '',
                time: time.format(
                  typeof data.last === 'string' ? new Date(data.last) : incident.started_at,
                ),
                normal: typeof data.normal === 'number' ? Math.round(data.normal * 10) / 10 : 0,
              })
            : kind === 'log_alert'
              ? t('summary.logAlert', {
                  search: typeof data.search === 'string' ? data.search : '',
                  query: typeof data.query === 'string' ? data.query : '',
                  minutes: typeof data.minutes === 'number' ? data.minutes : 15,
                })
              : t('summary.other')

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('trail')} className="text-sm text-muted-foreground">
        <Link href={`/p/${slug}`} className="text-brand underline underline-offset-2">
          {incident.project_name}
        </Link>{' '}
        / {t('emergencies')}
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex max-w-2xl flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={open ? 'destructive' : 'secondary'} className="gap-1">
                  {incident.level === 'emergency' ? (
                    <TriangleIcon className="size-3 fill-current" aria-hidden />
                  ) : (
                    <DiamondIcon className="size-3 fill-current" aria-hidden />
                  )}
                  {t(`level.${incident.level}`)} · {open ? t('ongoing') : t('over')}
                </Badge>
                <Badge variant="secondary">{t(`area.${AREA_OF[kind]}`)}</Badge>
                <span className="text-muted-foreground">
                  {t('started', { time: time.format(incident.started_at), duration: lasted })}
                </span>
              </div>
              <h1 className="font-display text-3xl font-semibold">{title}</h1>
              <p className="text-sm text-muted-foreground">{summary}</p>
            </div>
            {open && (
              <div className="flex flex-col items-end gap-2">
                <p
                  role="status"
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm',
                    incident.acknowledged_by
                      ? 'border-ok/40 bg-ok/10'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  {incident.acknowledged_by && <CheckIcon className="size-4 text-ok" aria-hidden />}
                  {incident.acknowledged_by
                    ? mine
                      ? t('onItYou', { time: time.format(incident.acknowledged_at as Date) })
                      : t('onIt', {
                          name: incident.acknowledged_name ?? '?',
                          time: time.format(incident.acknowledged_at as Date),
                        })
                    : t('nobody')}
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  {!mine && (
                    <TakeButton
                      incidentId={incident.id}
                      label={incident.acknowledged_by ? t('takeOver') : t('imOnIt')}
                    />
                  )}
                  <CloseDialog
                    incidentId={incident.id}
                    labels={{
                      trigger: t('close.trigger'),
                      title: t('close.title'),
                      body: t('close.body'),
                      why: t('close.why'),
                      cancel: common('cancel'),
                    }}
                  />
                </div>
              </div>
            )}
          </header>

          {incident.monitor_id && (
            <EmergencyChart
              checks={emergency.checks.map((c) => ({
                at: c.at.toISOString(),
                up: c.up,
                status: c.statusCode,
                ms: c.durationMs,
                result: c.up
                  ? c.statusCode
                    ? String(c.statusCode)
                    : t('chart.call')
                  : readable(c.error || `HTTP ${c.statusCode}`),
              }))}
              from={emergency.window.from.toISOString()}
              to={emergency.window.to.toISOString()}
              failureAt={failureAt?.toISOString() ?? incident.started_at.toISOString()}
              timeZone={timeZone}
              locale={locale}
              labels={{
                title: t('chart.title'),
                response: t('chart.response'),
                codes: t('chart.codes'),
                showTable: t('chart.showTable'),
                hideTable: t('chart.hideTable'),
                time: t('chart.time'),
                result: t('chart.result'),
                ms: t('chart.ms'),
                code: t('chart.result'),
                count: t('chart.count'),
                failure: reason
                  ? t('chart.failure', {
                      reason: statusCodeOf(reason) ?? readable(reason),
                      time: time.format(failureAt ?? incident.started_at),
                    })
                  : null,
                noChecks: emergency.complete ? t('chart.noChecks') : t('chart.unavailable'),
              }}
            />
          )}

          {kind === 'error_spike' && spike.issues.length > 0 && (
            <section
              aria-labelledby="spike-title"
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            >
              <h2 id="spike-title" className="font-semibold">
                {t('spike.title')}
              </h2>
              <ul className="flex flex-col gap-2">
                {spike.issues.map((issue) => (
                  <li key={issue.id} className="flex flex-col gap-0.5 text-sm">
                    <Link
                      href={`/p/${slug}/errors/${issue.id}`}
                      className="font-medium break-words text-brand underline underline-offset-4"
                    >
                      {issueTitle(issue)}
                    </Link>
                    <span className="text-muted-foreground">
                      {[
                        issue.culprit,
                        t('spike.events', { count: issue.count, minutes: spike.minutes }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href={`/p/${slug}/errors`}
                className="text-sm text-brand underline underline-offset-4"
              >
                {t('spike.all', { product: incident.project_name })}
              </Link>
            </section>
          )}

          <section
            aria-labelledby="happened-title"
            className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
          >
            <h2 id="happened-title" className="font-semibold">
              {t('happened')}
            </h2>
            <ol className="flex flex-col gap-3">
              {emergency.timeline.map((entry, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the record only grows at the end
                <li key={i} className="grid grid-cols-[4.5rem_1rem_minmax(0,1fr)] gap-2 text-sm">
                  <time
                    dateTime={entry.at.toISOString()}
                    className="text-muted-foreground tabular-nums"
                  >
                    {time.format(entry.at)}
                  </time>
                  <span className="pt-1">{ENTRY_ICON[entry.kind]}</span>
                  <div className="flex flex-col gap-0.5">{describe(entry)}</div>
                </li>
              ))}
            </ol>
            <NoteForm
              incidentId={incident.id}
              labels={{ placeholder: t('notePlaceholder'), add: t('addNote') }}
            />
          </section>
        </div>

        <aside aria-label={t('side')} className="flex flex-col gap-4">
          {checked && (
            <section
              aria-labelledby="checked-title"
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-center gap-1">
                <h2 id="checked-title" className="font-semibold">
                  {t('checked.title')}
                </h2>
                <InfoTip label={t('checked.infoLabel')} title={t('checked.title')}>
                  {t('checked.info')}
                </InfoTip>
              </div>
              <ul className="flex flex-col gap-2 text-sm">
                <Check
                  words={words}
                  ok={checked.ip !== null}
                  label={t('checked.dns')}
                  value={
                    checked.ip
                      ? `${checked.host} → ${checked.ip}`
                      : t('checked.noDns', { host: checked.host })
                  }
                />
                {checked.tls && (
                  <Check
                    words={words}
                    ok={checked.tls.trusted && checked.tls.daysLeft > 0}
                    label={t('checked.tls')}
                    value={
                      checked.tls.trusted
                        ? t('checked.tlsValid', { days: checked.tls.daysLeft })
                        : t('checked.tlsUntrusted')
                    }
                  />
                )}
                <Check
                  words={words}
                  ok={false}
                  label={t('checked.response')}
                  value={checked.error ? readable(checked.error) : String(checked.status ?? '–')}
                />
                {checked.controls.map((control) => (
                  <Check
                    words={words}
                    key={control.target}
                    ok={control.ms !== null}
                    label={t('checked.control', { target: control.target })}
                    value={
                      control.ms === null
                        ? t('checked.noAnswer')
                        : t('checked.answers', { ms: control.ms })
                    }
                  />
                ))}
                {checked.sameServer !== null && (
                  <Check
                    words={words}
                    ok={!checked.sameServer}
                    label={t('checked.sameServer')}
                    value={checked.sameServer ? t('checked.sameYes') : t('checked.sameNo')}
                  />
                )}
              </ul>
              <p className="text-sm text-muted-foreground">
                {checked.controls.length > 0 && checked.controls.every((c) => c.ms !== null)
                  ? checked.ip
                    ? t('checked.verdictServer', { ip: checked.ip })
                    : t('checked.verdictDns')
                  : t('checked.verdictNetwork')}
              </p>
            </section>
          )}

          {open && emergency.sameTime.length > 0 && (
            <section
              aria-labelledby="same-title"
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
            >
              <h2 id="same-title" className="font-semibold">
                {t(kind === 'error_spike' ? 'sameTime.titleOther' : 'sameTime.title')}
              </h2>
              {emergency.sameTime.some((s) => s.sameIp) && (
                <p className="text-sm text-muted-foreground">
                  {t('sameTime.sameIp', { ip: String(data.ip) })}
                </p>
              )}
              <SameTimeForm
                items={emergency.sameTime.map((s) => ({
                  id: s.id,
                  name: `${s.product} · ${s.name}`,
                  who: s.takenBy ? t('sameTime.onIt', { name: s.takenBy }) : t('sameTime.nobody'),
                }))}
                labels={{
                  legend: t(kind === 'error_spike' ? 'sameTime.titleOther' : 'sameTime.title'),
                  submit: t('sameTime.submit'),
                }}
              />
            </section>
          )}

          <section
            aria-labelledby="last-title"
            className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4"
          >
            <h2 id="last-title" className="font-semibold">
              {t('last.title')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {emergency.previous ? (
                <>
                  {t('last.body', {
                    date: day.format(emergency.previous.startedAt),
                    minutes: emergency.previous.minutes,
                  })}{' '}
                  <Link
                    href={`/p/${slug}/emergencies/${emergency.previous.id}`}
                    className="text-brand underline underline-offset-2"
                  >
                    {t('last.see')}
                  </Link>
                </>
              ) : (
                t('last.never')
              )}
            </p>
          </section>
        </aside>
      </div>
    </div>
  )

  function describe(entry: TimelineEntry): ReactNode {
    switch (entry.kind) {
      case 'firstFailure':
        return (
          <span>
            {entry.ms === null
              ? t('entry.firstFailure', { reason: readable(entry.reason) })
              : t('entry.firstFailureIn', { reason: readable(entry.reason), ms: entry.ms })}
          </span>
        )
      case 'opened':
        return (
          <span>
            {entry.failures ? t('entry.openedAfter', { count: entry.failures }) : t('entry.opened')}
          </span>
        )
      case 'sameIp':
        return (
          <span>
            {t('entry.sameIp', {
              product: entry.product,
              name: entry.name,
              time: time.format(entry.at),
            })}
          </span>
        )
      case 'told':
        return (
          <>
            <span>{entry.event === 'open' ? t('entry.told') : t('entry.toldOver')}</span>
            <span className="text-xs text-muted-foreground">
              {entry.channels.map((c, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: two channels may share a name
                <span key={`${c.name}-${i}`}>
                  {i > 0 && ' · '}
                  {c.name} {c.ok ? '✓' : `✕ ${c.error ?? ''}`}
                  <span className="sr-only">{c.ok ? t('entry.sent') : t('entry.failed')}</span>
                </span>
              ))}
            </span>
          </>
        )
      case 'took':
        return (
          <>
            <span>
              {entry.first
                ? t('entry.took', { name: entry.name })
                : t('entry.tookOver', { name: entry.name })}
            </span>
            {entry.first && (
              <span className="text-xs text-muted-foreground">{t('entry.tookHint')}</span>
            )}
          </>
        )
      case 'note':
        return (
          <span>
            <strong className="font-medium">{entry.name}</strong>: “{entry.body}”
          </span>
        )
      case 'closed':
        return (
          <span>
            {t('entry.closed', { name: entry.name })} “{entry.body}”
          </span>
        )
      case 'resolved':
        return <span>{t('entry.resolved')}</span>
    }
  }
}

const ENTRY_ICON: Record<TimelineEntry['kind'], ReactNode> = {
  firstFailure: <TriangleIcon className="size-3 fill-current text-error" aria-hidden />,
  opened: <TriangleIcon className="size-3 fill-current text-error" aria-hidden />,
  sameIp: <TriangleIcon className="size-3 text-error" aria-hidden />,
  told: <CircleIcon className="size-2.5 fill-current text-muted-foreground" aria-hidden />,
  took: <CircleIcon className="size-2.5 fill-current text-ok" aria-hidden />,
  note: <CircleIcon className="size-2.5 fill-current text-muted-foreground" aria-hidden />,
  closed: <CheckIcon className="size-3 text-ok" aria-hidden />,
  resolved: <CheckIcon className="size-3 text-ok" aria-hidden />,
}

function Check({
  ok,
  label,
  value,
  words,
}: {
  ok: boolean
  label: string
  value: string
  words: { ok: string; fail: string }
}) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CheckIcon className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
      ) : (
        <XIcon className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
      )}
      <span className="sr-only">{ok ? words.ok : words.fail}</span>
      <span className="flex-1">{label}</span>
      <span className="text-right text-muted-foreground">{value}</span>
    </li>
  )
}
