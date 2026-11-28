import {
  getProjectBySlug,
  lastUsageEvent,
  listKeyEvents,
  listSources,
  usageEvents,
} from '@octadash/db'
import { ArrowLeftIcon, CheckIcon, CodeIcon, PlusIcon, ShieldCheckIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { dismissAreaAction } from '@/actions/areas'
import { addUsageToSourceAction } from '@/actions/usage'
import { KeyEventsForm } from '@/components/key-events-form'
import { RouteDialog, RouteSheet } from '@/components/route-overlay'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { UsageInstall } from '@/components/usage-install'
import { UsageSourceForm } from '@/components/usage-source-form'
import { tabOf } from '@/lib/usage-setup'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('usageSetup')
  return { title: t('title') }
}

/**
 * Set up Product usage for one product, as closed in the Product usage
 * canvas: its sources (the Traffic script already sends events, so no new key
 * is needed), a new source, and for the chosen one the code to send an event,
 * how to tie events to a person, the key events and a live wait.
 */
export default async function UsageSetupPage({
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
  const [sources, keys, seen, t, te, tp, format] = await Promise.all([
    listSources(db, org.id, project.id),
    listKeyEvents(db, org.id, [project.id]),
    usageEvents(clickhouse, {
      orgId: org.id,
      projectIds: [project.id],
      from: new Date(now.getTime() - 7 * 86_400_000),
      to: now,
    }).catch(() => []),
    getTranslations('usageSetup'),
    getTranslations('errorsSetup'),
    getTranslations('platforms'),
    getFormatter(),
  ])
  const sending = sources.filter((s) => s.areas.includes('usage'))
  const last = new Map(
    await Promise.all(
      sending.map(
        async (s) =>
          [
            s.id,
            await lastUsageEvent(clickhouse, org.id, project.id, s.id).catch(() => null),
          ] as const,
      ),
    ),
  )
  // The code opens in a panel over the list, for the source in the address.
  const current = chosen ? sending.find((s) => s.id === chosen) : undefined
  const base = `/p/${project.slug}/usage/setup`

  const status = (s: (typeof sources)[number]) => {
    if (s.areas.includes('usage')) {
      const event = last.get(s.id)
      return event
        ? t('status.receiving', { time: format.relativeTime(event.at, now) })
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

  const events = [
    ...seen.map((e) => ({ event: e.event, count: e.count })),
    ...keys
      .filter((k) => !seen.some((e) => e.event === k.event))
      .map((k) => ({ event: k.event, count: 0 })),
  ].map((e) => ({ ...e, normal: t('inWeek', { count: e.count }) }))

  return (
    <>
      <nav aria-label={t('trail')} className="text-sm text-muted-foreground">
        <Link href={`/p/${project.slug}/usage`} className="text-brand underline underline-offset-4">
          {t('usage')}
        </Link>{' '}
        / {project.name}
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        {manager && (
          <Button asChild>
            <Link href={`/p/${project.slug}/usage/setup?add=1`}>
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
                          {s.areas.includes('usage') ? (
                            <Button asChild size="sm" variant="outline">
                              <Link href={`${base}?source=${s.id}`} scroll={false}>
                                <CodeIcon data-icon="inline-start" aria-hidden />
                                {t('show')}
                              </Link>
                            </Button>
                          ) : (
                            manager && (
                              <form action={addUsageToSourceAction}>
                                <input type="hidden" name="slug" value={project.slug} />
                                <input type="hidden" name="source" value={s.id} />
                                <Button type="submit" size="sm" variant="outline">
                                  {t('useForUsage')}
                                </Button>
                              </form>
                            )
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
                {sources.some((s) => s.areas.includes('traffic')) && (
                  <p className="pt-3 text-xs text-muted-foreground">{t('scriptHint')}</p>
                )}
              </CardContent>
            </Card>
          )}

          {sources.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-start gap-3">
                <p className="text-sm text-muted-foreground">
                  {manager ? t('empty') : t('noSource')}
                </p>
                {manager && (
                  <Button asChild>
                    <Link href={`${base}?add=1`} scroll={false}>
                      <PlusIcon data-icon="inline-start" aria-hidden />
                      {t('addSource')}
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {manager && add === '1' && (
            <RouteDialog closeHref={base} title={t('addSource')} description={t('addSourceHint')}>
              <UsageSourceForm slug={project.slug} />
            </RouteDialog>
          )}

          {current?.public_key && (
            <RouteSheet
              closeHref={base}
              title={current.name}
              description={t('codeHint')}
              closeLabel={t('close')}
            >
              <UsageInstall
                key={current.id}
                sourceId={current.id}
                ingestUrl={env.OCTADASH_INGEST_URL}
                publicKey={current.public_key}
                hasScript={current.areas.includes('traffic')}
                tab={tabOf(current.platform)}
                usageHref={`/p/${project.slug}/usage`}
                keyEvents={
                  <KeyEventsForm
                    slug={project.slug}
                    events={events}
                    keys={keys.map((k) => k.event)}
                    canEdit={manager}
                  />
                }
              />
            </RouteSheet>
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
                <input type="hidden" name="area" value="usage" />
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
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="text-sm font-semibold">{t('funnelsTitle')}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t('funnelsBody')}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
