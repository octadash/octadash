import { getProjectBySlug, lastPageview, listSources } from '@octadash/db'
import { ArrowLeftIcon, CheckIcon, PlusIcon, ShieldCheckIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { dismissAreaAction } from '@/actions/areas'
import { addTrafficToSourceAction } from '@/actions/traffic'
import { CopyField } from '@/components/copy-field'
import { TrafficInstall } from '@/components/traffic-install'
import { TrafficSourceForm } from '@/components/traffic-source-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { isTrafficPlatform } from '@/lib/traffic-setup'
import { cn } from '@/lib/utils'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

/**
 * Set up Traffic for one product: its sources (an existing one can start
 * sending page views), a new source, and for the chosen one the code, the
 * options and a live check that page views arrive.
 */
export default async function TrafficSetupPage({
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
  const [sources, t, tp, format] = await Promise.all([
    listSources(db, org.id, project.id),
    getTranslations('trafficSetup'),
    getTranslations('platforms'),
    getFormatter(),
  ])
  const traffic = sources.filter((s) => s.areas.includes('traffic'))
  const last = new Map(
    await Promise.all(
      traffic.map(
        async (s) =>
          [s.id, await lastPageview(clickhouse, org.id, s.id).catch(() => null)] as const,
      ),
    ),
  )
  const current = traffic.find((s) => s.id === chosen) ?? traffic[0]
  // Real numbers exist: the made-up example would only confuse.
  const receiving = [...last.values()].some(Boolean)
  const base = `/p/${project.slug}/traffic/setup`

  const status = (s: (typeof sources)[number]) => {
    if (s.areas.includes('traffic')) {
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        {manager && traffic.length > 0 && add !== '1' && (
          <Button asChild>
            <Link href={`/p/${project.slug}/traffic/setup?add=1#add`}>
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
                {traffic.length === 0 && (
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
                            {s.platform && isTrafficPlatform(s.platform) && (
                              <Badge variant="secondary">{tp(s.platform)}</Badge>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">{status(s)}</span>
                        </div>
                        <div className="ml-auto">
                          {s.areas.includes('traffic') ? (
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
                              <form action={addTrafficToSourceAction}>
                                <input type="hidden" name="slug" value={project.slug} />
                                <input type="hidden" name="source" value={s.id} />
                                <Button type="submit" size="sm" variant="outline">
                                  {t('useForTraffic')}
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
            (traffic.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2 className="font-display text-lg font-semibold">{t('addSource')}</h2>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <TrafficSourceForm slug={project.slug} />
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
                      <Link href={`/p/${project.slug}/traffic/setup`}>{t('cancel')}</Link>
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <TrafficSourceForm slug={project.slug} />
                  </CardContent>
                </Card>
              )
            ))}

          {current ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2 className="font-display text-lg font-semibold">{current.name}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {current.public_key && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium">{t('key')}</span>
                    <CopyField
                      value={current.public_key}
                      label={t('key')}
                      copyLabel={t('copy')}
                      copiedLabel={t('copied')}
                    />
                    <span className="text-xs text-muted-foreground">{t('keyHint')}</span>
                  </div>
                )}
                <TrafficInstall
                  key={current.id}
                  slug={project.slug}
                  sourceId={current.id}
                  ingestUrl={env.OCTADASH_INGEST_URL}
                  publicKey={current.public_key ?? ''}
                  platform={
                    current.platform && isTrafficPlatform(current.platform)
                      ? current.platform
                      : 'html'
                  }
                  persistent={current.visitor_mode === 'persistent'}
                  manager={manager}
                  trafficHref={`/p/${project.slug}/traffic`}
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
            {manager && traffic.length === 0 && (
              <form action={dismissAreaAction}>
                <input type="hidden" name="slug" value={project.slug} />
                <input type="hidden" name="area" value="traffic" />
                <Button type="submit" variant="ghost" className="text-muted-foreground">
                  {t('wontUse')}
                </Button>
              </form>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {!receiving && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle>
                  <h2 className="text-sm font-semibold">{t('example')}</h2>
                </CardTitle>
                <Badge variant="outline">{t('exampleBadge')}</Badge>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <dl className="grid grid-cols-2 gap-3">
                  {[
                    [t('exampleVisitors'), 1284],
                    [t('examplePageviews'), 3902],
                  ].map(([label, value]) => (
                    <div key={label} className="flex flex-col gap-0.5">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="font-display text-xl font-semibold tabular-nums">
                        {format.number(Number(value))}
                      </dd>
                    </div>
                  ))}
                </dl>
                <ExampleBars />
              </CardContent>
            </Card>
          )}
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

/** A decorative chart for the example card: the numbers above say the same. */
function ExampleBars() {
  const heights = [38, 52, 44, 61, 57, 72, 66, 80, 74, 88, 70, 92, 84, 96]
  return (
    <div aria-hidden className="flex h-16 items-end gap-1">
      {heights.map((h, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative bars
          key={i}
          className={cn('flex-1 rounded-sm bg-brand/60', i === heights.length - 1 && 'bg-brand')}
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  )
}
