import { getProjectBySlug, listMonitors } from '@octadash/db'
import { PlusIcon, ServerIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { pauseMonitorAction } from '@/actions/monitors'
import { CopyField } from '@/components/copy-field'
import { DeleteMonitorDialog } from '@/components/delete-monitor-dialog'
import { HealthSnippets } from '@/components/health-snippets'
import { StatusDot } from '@/components/status-dot'
import { Button } from '@/components/ui/button'
import { describeFailure, durationLabel } from '@/lib/monitors'
import { services } from '@/server/context'
import { sameServerUrls } from '@/server/same-server'
import { canManage, requireOrg } from '@/server/session'
import { formatUptime, safeMonitorStats } from '@/server/uptime-view'

/** Uptime of one product: its monitors, their numbers, and how to add a good one. */
export default async function ProductUptimePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { org } = await requireOrg()
  const { db, env, clickhouse } = services()
  const project = await getProjectBySlug(db, org.id, slug)
  if (!project) notFound()
  const monitors = await listMonitors(db, org.id, project.id)
  const [stats, sameServer, t, common, format, tf] = await Promise.all([
    safeMonitorStats(
      clickhouse,
      org.id,
      monitors.map((m) => m.id),
    ),
    sameServerUrls(
      env.OCTADASH_URL,
      monitors.flatMap((m) => (m.url ? [m.url] : [])),
    ),
    getTranslations('uptime'),
    getTranslations('common'),
    getFormatter(),
    getTranslations('monitorForm'),
  ])
  const manager = canManage(org.role)
  const duration = (seconds: number) => durationLabel(seconds, (key, values) => t(key, values))
  const first = monitors.length === 0
  const addButton = manager && (
    <Button size="lg" className="px-4" asChild>
      <Link href={`/p/${project.slug}/uptime/new`}>
        <PlusIcon data-icon="inline-start" />
        {first ? t('addFirst') : t('add')}
      </Link>
    </Button>
  )

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        {!first && addButton}
      </div>

      {first ? (
        <section className="flex flex-col items-start gap-4 rounded-xl border border-dashed border-input p-6">
          <p className="max-w-xl text-sm leading-relaxed">{t('empty')}</p>
          {addButton}
        </section>
      ) : (
        <ul className="flex flex-col gap-3">
          {monitors.map((monitor) => {
            const s = stats.get(monitor.id)
            const status = monitor.paused ? 'paused' : monitor.status
            const statusLabel = {
              up: t('statusUp'),
              down: t('statusDown'),
              unknown: t('statusUnknown'),
              paused: t('statusPaused'),
            }[status]
            const pingUrl = monitor.heartbeat_token
              ? `${env.OCTADASH_INGEST_URL.replace(/\/$/, '')}/hb/${monitor.heartbeat_token}`
              : null
            return (
              <li
                key={monitor.id}
                className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <StatusDot status={status} className="mt-2 size-2.5" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <h2 className="font-display text-lg font-semibold">{monitor.name}</h2>
                    <p className="truncate text-sm text-muted-foreground">
                      {monitor.url ?? t('kindHeartbeat')} ·{' '}
                      {monitor.kind === 'heartbeat'
                        ? `${t('intervalHeartbeat').toLowerCase()} ${duration(monitor.interval_seconds)}`
                        : `${t('interval').toLowerCase()} ${duration(monitor.interval_seconds)}`}
                    </p>
                    <p className="text-sm">
                      {statusLabel}
                      {monitor.status_since && !monitor.paused && (
                        <span className="text-muted-foreground">
                          {' '}
                          {t('since', {
                            time: format.dateTime(monitor.status_since, {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            }),
                          })}
                        </span>
                      )}
                      {monitor.status === 'down' && s?.lastError && (
                        <span className="text-muted-foreground">
                          {' '}
                          ·{' '}
                          {describeFailure(s.lastError, (key, values) =>
                            t(`failure.${key}`, values),
                          )}
                        </span>
                      )}
                    </p>
                  </div>
                  {manager && (
                    <div className="flex flex-wrap gap-1">
                      <Button variant="ghost" asChild>
                        <Link href={`/p/${project.slug}/uptime/${monitor.id}/edit`}>
                          {t('edit')}
                        </Link>
                      </Button>
                      <form action={pauseMonitorAction}>
                        <input type="hidden" name="monitorId" value={monitor.id} />
                        <input type="hidden" name="paused" value={String(!monitor.paused)} />
                        <Button type="submit" variant="ghost">
                          {monitor.paused ? t('resume') : t('pause')}
                        </Button>
                      </form>
                      <DeleteMonitorDialog
                        monitorId={monitor.id}
                        labels={{
                          trigger: t('delete'),
                          title: t('deleteTitle', { name: monitor.name }),
                          body: t('deleteBody'),
                          cancel: common('cancel'),
                        }}
                      />
                    </div>
                  )}
                </div>

                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
                  <Metric label={t('uptime30')} value={formatUptime(s?.uptime ?? null)} />
                  {monitor.kind !== 'heartbeat' && (
                    <Metric
                      label={t('response')}
                      value={s?.medianMs == null ? '–' : `${s.medianMs} ms`}
                    />
                  )}
                  {monitor.kind !== 'heartbeat' && (
                    <Metric
                      label={t('certificate')}
                      value={s?.certDays == null ? '–' : t('certDays', { count: s.certDays })}
                      warn={s?.certDays != null && s.certDays <= 14}
                    />
                  )}
                  <Metric
                    label={t('lastCheck')}
                    value={s?.lastAt ? format.relativeTime(s.lastAt) : t('never')}
                  />
                </dl>

                {pingUrl && (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {t('pingUrl')}
                    </span>
                    <CopyField
                      value={pingUrl}
                      copyLabel={common('copy')}
                      copiedLabel={common('copied')}
                    />
                    <p className="text-xs text-muted-foreground">{t('pingHint')}</p>
                    <code className="rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs break-all">
                      {`curl -fsS -m 10 --retry 3 ${pingUrl}`}
                    </code>
                  </div>
                )}

                {monitor.url && sameServer.has(monitor.url) && (
                  <div className="flex gap-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
                    <ServerIcon className="mt-0.5 size-4 shrink-0 text-warn" />
                    <div className="flex flex-col gap-1">
                      <p className="font-medium">{t('sameServerTitle')}</p>
                      <p className="text-muted-foreground">{t('sameServerBody')}</p>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-border p-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-semibold">{t('healthTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('healthBody')}</p>
        </div>
        <HealthSnippets
          copy={common('copy')}
          copied={common('copied')}
          label={tf('framework')}
          other={tf('other')}
        />
      </section>
    </>
  )
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={warn ? 'font-medium text-warn' : 'font-medium'}>{value}</dd>
    </div>
  )
}
