import { getProjectBySlug, lastError, listSources, sentryDsn } from '@octadash/db'
import { ArrowLeftIcon, CheckIcon, ShieldCheckIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { dismissAreaAction } from '@/actions/areas'
import { addErrorsToSourceAction } from '@/actions/error-sources'
import { CopyField } from '@/components/copy-field'
import { ErrorSourceForm } from '@/components/error-source-form'
import { ErrorsInstall } from '@/components/errors-install'
import { InfoTip } from '@/components/info-tip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isErrorPlatform } from '@/lib/errors-setup'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('errorsSetup')
  return { title: t('title') }
}

/**
 * Set up Errors for one product, as closed in the Configure canvas: its
 * sources (one that already sends page views can start sending errors), a new
 * source, and for the chosen one its DSN, the code for each platform, a test
 * error and a live wait for the first error.
 */
export default async function ErrorsSetupPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ source?: string }>
}) {
  const { slug } = await params
  const { source: chosen } = await searchParams
  const { org } = await requireOrg()
  const { db, clickhouse, env } = services()
  const project = await getProjectBySlug(db, org.id, slug)
  if (!project) notFound()
  const manager = canManage(org.role)
  const [sources, t, tp, format] = await Promise.all([
    listSources(db, org.id, project.id),
    getTranslations('errorsSetup'),
    getTranslations('platforms'),
    getFormatter(),
  ])
  const sending = sources.filter((s) => s.areas.includes('errors'))
  const last = new Map(
    await Promise.all(
      sending.map(
        async (s) =>
          [s.id, await lastError(clickhouse, org.id, project.id, s.id).catch(() => null)] as const,
      ),
    ),
  )
  const current = sending.find((s) => s.id === chosen) ?? sending[0]
  const base = `/p/${project.slug}/errors/setup`
  const ingest = env.OCTADASH_INGEST_URL

  const status = (s: (typeof sources)[number]) => {
    if (s.areas.includes('errors')) {
      const seen = last.get(s.id)
      return seen
        ? t('status.receiving', { time: format.relativeTime(seen.at) })
        : t('status.waiting')
    }
    const areas = s.areas.filter((a) => t.has(`areaNames.${a}`))
    return areas.length > 0
      ? t('status.other', {
          areas: format.list(
            areas.map((a) => t(`areaNames.${a}`)),
            { type: 'conjunction' },
          ),
        })
      : t('status.nothing')
  }

  return (
    <>
      <nav aria-label={t('trail')} className="text-sm text-muted-foreground">
        <Link
          href={`/p/${project.slug}/errors`}
          className="text-brand underline underline-offset-4"
        >
          {t('errors')}
        </Link>{' '}
        / {project.name}
      </nav>
      <div className="flex max-w-2xl flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
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
                          {s.areas.includes('errors') ? (
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
                              <form action={addErrorsToSourceAction}>
                                <input type="hidden" name="slug" value={project.slug} />
                                <input type="hidden" name="source" value={s.id} />
                                <Button type="submit" size="sm" variant="outline">
                                  {t('useForErrors')}
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
                  <ErrorSourceForm slug={project.slug} />
                </CardContent>
              </Card>
            ) : (
              <details className="group rounded-xl border border-border px-5 py-3 open:pb-5">
                <summary className="cursor-pointer text-sm font-medium">{t('addAnother')}</summary>
                <div className="pt-4">
                  <ErrorSourceForm slug={project.slug} />
                </div>
              </details>
            ))}

          {current?.public_key ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2 className="font-display text-lg font-semibold">{current.name}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-1 text-sm font-medium">
                    {t('dsn')}
                    <InfoTip label={t('dsnInfoLabel')} title={t('dsn')}>
                      {t('dsnInfo')}
                    </InfoTip>
                  </span>
                  <CopyField
                    value={sentryDsn(ingest, current.public_key, String(project.ingest_id))}
                    label={t('dsn')}
                    copyLabel={t('copy')}
                    copiedLabel={t('copied')}
                  />
                  <span className="text-xs text-muted-foreground">{t('dsnHint')}</span>
                </div>
                <ErrorsInstall
                  key={current.id}
                  sourceId={current.id}
                  ingestUrl={ingest}
                  publicKey={current.public_key}
                  dsn={sentryDsn(ingest, current.public_key, String(project.ingest_id))}
                  platform={
                    current.platform && isErrorPlatform(current.platform)
                      ? current.platform
                      : 'other'
                  }
                  issueHref={`/p/${project.slug}/errors`}
                  errorsHref={`/p/${project.slug}/errors`}
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
                <input type="hidden" name="area" value="errors" />
                <Button type="submit" variant="ghost" className="text-muted-foreground">
                  {t('wontUse')}
                </Button>
              </form>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle>
                <h2 className="text-sm font-semibold">{t('example')}</h2>
              </CardTitle>
              <Badge variant="outline">{t('exampleBadge')}</Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul className="flex flex-col gap-3">
                {(t.raw('exampleIssues') as { title: string; meta: string }[]).map((e) => (
                  <li key={e.title} className="flex flex-col gap-0.5">
                    <span className="font-mono text-xs font-medium break-words">{e.title}</span>
                    <span className="text-xs text-muted-foreground">{e.meta}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t('exampleNote')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheckIcon aria-hidden className="size-4 text-ok" />
                  {t('private')}
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                {(t.raw('privateItems') as string[]).map((item) => (
                  <li key={item} className="flex gap-2">
                    <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" />
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
