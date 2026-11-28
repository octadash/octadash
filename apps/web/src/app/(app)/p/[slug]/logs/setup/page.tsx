import {
  DEFAULT_LOG_RETENTION_DAYS,
  getProjectBySlug,
  lastLogLine,
  listSources,
  logBytesPerDay,
  logRetention,
  maskedCount,
} from '@octadash/db'
import { ArrowLeftIcon, CheckIcon, PlusIcon, ShieldCheckIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { dismissAreaAction } from '@/actions/areas'
import { addLogsToSourceAction } from '@/actions/logs'
import { LogSourceForm } from '@/components/log-source-form'
import { LogsInstall } from '@/components/logs-install'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { logTabOf } from '@/lib/logs-setup'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('logsSetup')
  return { title: t('title') }
}

/**
 * Set up Logs for one product, as closed in the Logs canvas: its sources (a
 * source that sends errors sends lines with the same key), a new source, and
 * for the chosen one the code per language, how long to keep the lines and a
 * live wait for the first one.
 */
export default async function LogsSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ source?: string; add?: string }>
}) {
  const { slug } = await params
  const { source: chosen, add } = await searchParams
  const { org } = await requireOrg()
  const { db, clickhouse, env } = services()
  const project = await getProjectBySlug(db, org.id, slug)
  if (!project) notFound()
  const manager = canManage(org.role)
  const now = new Date()
  const [sources, retention, bytesPerDay, masked, t, te, tp, format] = await Promise.all([
    listSources(db, org.id, project.id),
    logRetention(db, [project.id]),
    logBytesPerDay(clickhouse, org.id, project.id, now).catch(() => 0),
    maskedCount(clickhouse, {
      orgId: org.id,
      projectIds: [project.id],
      from: new Date(now.getTime() - 7 * 86_400_000),
      to: now,
    }).catch(() => 0),
    getTranslations('logsSetup'),
    getTranslations('errorsSetup'),
    getTranslations('platforms'),
    getFormatter(),
  ])
  const sending = sources.filter((s) => s.areas.includes('logs'))
  const last = new Map(
    await Promise.all(
      sending.map(
        async (s) =>
          [
            s.id,
            await lastLogLine(clickhouse, org.id, project.id, s.id).catch(() => null),
          ] as const,
      ),
    ),
  )
  const current = sending.find((s) => s.id === chosen) ?? sending[0]
  const base = `/p/${project.slug}/logs/setup`

  const status = (s: (typeof sources)[number]) => {
    if (s.areas.includes('logs')) {
      const line = last.get(s.id)
      return line
        ? t('status.receiving', { time: format.relativeTime(new Date(line.at), now) })
        : t('status.waiting')
    }
    const areas = s.areas.filter((a) => te.has(`areaNames.${a}`))
    return areas.length > 0
      ? t('status.other', {
          areas: format.list(
            areas.map((a) => te(`areaNames.${a}`)),
            { type: 'conjunction' },
          ),
        })
      : t('status.nothing')
  }

  return (
    <>
      <nav aria-label={t('trail')} className="text-sm text-muted-foreground">
        <Link href={`/p/${project.slug}/logs`} className="text-brand underline underline-offset-4">
          {t('logs')}
        </Link>{' '}
        / {project.name}
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        {manager && sending.length > 0 && add !== '1' && (
          <Button asChild>
            <Link href={`/p/${project.slug}/logs/setup?add=1#add`}>
              <PlusIcon data-icon="inline-start" aria-hidden />
              {t('addSource')}
            </Link>
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {sources.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2 className="font-display text-lg font-semibold">{t('sources')}</h2>
                </CardTitle>
                {sending.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('sourcesHint')}</p>
                )}
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y divide-border">
                  {sources.map((s) => {
                    const isCurrent = s.id === current?.id
                    return (
                      <li
                        key={s.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
                      >
                        <div className="flex min-w-48 flex-1 flex-col gap-0.5">
                          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            {s.name}
                            {s.platform && tp.has(s.platform) && (
                              <Badge variant="secondary">{tp(s.platform)}</Badge>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">{status(s)}</span>
                        </div>
                        <div className="ml-auto">
                          {s.areas.includes('logs') ? (
                            <Button asChild size="sm" variant={isCurrent ? 'secondary' : 'outline'}>
                              <Link
                                href={`${base}?source=${s.id}`}
                                aria-current={isCurrent ? 'true' : undefined}
                              >
                                {isCurrent && <CheckIcon data-icon="inline-start" aria-hidden />}
                                {t('show')}
                              </Link>
                            </Button>
                          ) : (
                            manager && (
                              <form action={addLogsToSourceAction}>
                                <input type="hidden" name="slug" value={project.slug} />
                                <input type="hidden" name="source" value={s.id} />
                                <Button type="submit" size="sm" variant="outline">
                                  {t('useForLogs')}
                                </Button>
                              </form>
                            )
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
          )}

          {manager &&
            (sending.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2 className="font-display text-lg font-semibold">{t('addSource')}</h2>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <LogSourceForm slug={project.slug} />
                </CardContent>
              </Card>
            ) : (
              add === '1' && (
                <Card id="add" className="scroll-mt-6 border-brand/40">
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <CardTitle>
                      <h2 className="font-display text-lg font-semibold">{t('addSource')}</h2>
                    </CardTitle>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/p/${project.slug}/logs/setup`}>{t('cancel')}</Link>
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <LogSourceForm slug={project.slug} />
                  </CardContent>
                </Card>
              )
            ))}

          {current?.public_key ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2 className="font-display text-lg font-semibold">{current.name}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <LogsInstall
                  key={current.id}
                  slug={project.slug}
                  sourceId={current.id}
                  ingestUrl={env.OCTADASH_INGEST_URL}
                  publicKey={current.public_key}
                  tab={logTabOf(current.platform)}
                  service={project.slug}
                  retention={retention.get(project.id) ?? DEFAULT_LOG_RETENTION_DAYS}
                  bytesPerDay={bytesPerDay}
                  canEdit={manager}
                  logsHref={`/p/${project.slug}/logs`}
                />
              </CardContent>
            </Card>
          ) : (
            !manager && <p className="text-sm text-muted-foreground">{t('noSource')}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/p/${project.slug}`}>
                <ArrowLeftIcon data-icon="inline-start" aria-hidden />
                {t('back', { name: project.name })}
              </Link>
            </Button>
            {manager && sending.length === 0 && (
              <form action={dismissAreaAction}>
                <input type="hidden" name="slug" value={project.slug} />
                <input type="hidden" name="area" value="logs" />
                <Button type="submit" variant="ghost" className="text-muted-foreground">
                  {t('wontUse')}
                </Button>
              </form>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="text-sm font-semibold">{t('seqTitle')}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t('seqBody')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheckIcon aria-hidden className="size-4 text-ok" />
                  {t('notLogTitle')}
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t('notLogBody')}</p>
              <p className="text-xs text-muted-foreground">
                {masked > 0 ? t('maskedWeek', { count: masked }) : t('maskedNone')}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
