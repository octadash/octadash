import type { TrafficDimension, TrafficFilter } from '@octadash/db'
import { ArrowRightIcon, FilterIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { InfoTip } from '@/components/info-tip'
import { MetricChart } from '@/components/metric-chart'
import { TrafficCard, type TrafficContext } from '@/components/traffic-lists'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { percentChange } from '@/lib/period'
import {
  flagOf,
  TRAFFIC_PERIODS,
  type TrafficMetric,
  type TrafficPeriodId,
  trafficHref,
} from '@/lib/traffic'
import { cn } from '@/lib/utils'
import { loadTraffic, TRAFFIC_CARDS } from '@/server/traffic'

/**
 * The Traffic page, as closed in the Traffic canvas: numbers on top that
 * switch the chart, the chart against the previous period, then lists with
 * bars. Any row filters the whole page (a chip on top). All products and
 * groups get a Products list first and show whose each page is. Only numbers
 * the engine has: no bounce rate or visit time yet.
 */
export async function TrafficView({
  orgId,
  projectIds,
  path,
  scope,
  periodId,
  metric,
  filters,
  group,
  product,
}: {
  orgId: string
  projectIds: string[] | null
  /** "/all/traffic", "/g/<slug>/traffic", "/p/<slug>/traffic". */
  path: string
  /** For "Details": `all`, `g:<slug>`, `p:<slug>`. */
  scope: string
  periodId: TrafficPeriodId
  metric: TrafficMetric
  filters: TrafficFilter[]
  group?: string
  product?: { name: string; slug: string }
}) {
  const [data, t, locale] = await Promise.all([
    loadTraffic(orgId, projectIds, periodId, filters),
    getTranslations('traffic'),
    getLocale(),
  ])
  const number = new Intl.NumberFormat(locale)
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
  const percent = new Intl.NumberFormat(locale, { style: 'percent' })
  const state = { period: periodId, metric, filters }
  const names = Object.fromEntries(data.projects.map((p) => [p.id, p.name]))
  const several = data.projects.length > 1
  const { totals, previous } = data
  const perVisitor = (s: { pageviews: number; visitors: number }) =>
    s.visitors > 0 ? s.pageviews / s.visitors : 0

  const context: TrafficContext = {
    path,
    scope,
    state,
    products: names,
    several,
    totalVisitors: totals.visitors,
  }
  const listOf = (dimension: TrafficDimension) => ({
    dimension,
    rows: data.lists[dimension]?.rows ?? [],
    total: data.lists[dimension]?.total ?? 0,
  })

  // Nothing to show yet: no source sends page views and nothing came in.
  if (data.sources.length === 0 && totals.visitors === 0 && filters.length === 0) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{t('none.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('none.body')}</p>
            {product ? (
              <Button asChild className="self-start">
                <Link href={`/p/${product.slug}/traffic/setup`}>{t('none.setUp')}</Link>
              </Button>
            ) : (
              <>
                <p className="text-sm font-medium">{t('none.all')}</p>
                <ul className="flex flex-wrap gap-2">
                  {data.projects.map((p) => (
                    <li key={p.id}>
                      <Button asChild variant="outline">
                        <Link href={`/p/${p.slug}/traffic/setup`}>{p.name}</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  const filterName = (f: TrafficFilter) => {
    const v = f.value
    const value =
      f.dimension === 'product'
        ? (names[v] ?? v)
        : f.dimension === 'channel' && t.has(`values.channel.${v}`)
          ? t(`values.channel.${v}`)
          : f.dimension === 'source' && !v
            ? t('values.direct')
            : f.dimension === 'country' && v
              ? `${flagOf(v)} ${new Intl.DisplayNames([locale], { type: 'region' }).of(v) ?? v}`
              : (f.dimension === 'device' || f.dimension === 'screen') &&
                  t.has(`values.${f.dimension}.${v}`)
                ? t(`values.${f.dimension}.${v}`)
                : v || t('values.none')
    return `${t(`dimensions.${f.dimension}`)}: ${value}`
  }

  const change = (now: number, before: number) => {
    const c = percentChange(now, before)
    return c === null
      ? null
      : { text: `${c > 0 ? '↑' : c < 0 ? '↓' : ''} ${Math.abs(c)}%`, up: c > 0, down: c < 0, c }
  }
  const tiles: { id: TrafficMetric; value: string; delta: ReturnType<typeof change> }[] = [
    {
      id: 'visitors',
      value: number.format(totals.visitors),
      delta: change(totals.visitors, previous.visitors),
    },
    {
      id: 'pageviews',
      value: number.format(totals.pageviews),
      delta: change(totals.pageviews, previous.pageviews),
    },
    {
      id: 'perVisitor',
      value: decimal.format(perVisitor(totals)),
      delta: change(perVisitor(totals), perVisitor(previous)),
    },
  ]

  const metricOf = (p: { visitors: number; pageviews: number } | undefined) =>
    p === undefined
      ? null
      : metric === 'visitors'
        ? p.visitors
        : metric === 'pageviews'
          ? p.pageviews
          : Math.round(perVisitor(p) * 100) / 100
  const offset = data.previousSeries.length - data.series.length
  const points = data.series.map((p, i) => ({
    at: p.at.toISOString(),
    current: metricOf(p),
    previous: metricOf(data.previousSeries[i + offset]),
  }))

  const subtitle = product
    ? t('introOne', {
        product: product.name,
        count: data.sources.length,
        sources: data.sources.map((s) => s.name).join(', '),
      })
    : group
      ? t('introGroup', { group })
      : t('intro')

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-2">
            <span aria-hidden className="size-2 rounded-full bg-ok" />
            {t('online', { count: data.online })}
          </span>
          {product && (
            <Link
              href={`/p/${product.slug}/traffic/setup`}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t('setUpLink')}
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label={t('periodLabel')} className="flex rounded-lg border border-border p-0.5">
          {TRAFFIC_PERIODS.map((id) => (
            <Link
              key={id}
              href={trafficHref(path, state, { period: id })}
              aria-current={id === periodId ? 'true' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground',
                id === periodId && 'bg-secondary font-medium text-foreground',
              )}
            >
              {t(`periods.${id}`)}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-muted-foreground">
          {t('compared', { period: t(`periodNames.${periodId}`) })}
          {totals.bots > 0 && ` · ${t('bots', { count: totals.bots })}`}
        </p>
      </div>

      <section
        aria-label={t('filtersLabel')}
        className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <FilterIcon aria-hidden className="size-4 text-muted-foreground" />
          {t('filtersLabel')}
        </span>
        {filters.length === 0 ? (
          <span className="text-muted-foreground">{t('filterHint')}</span>
        ) : (
          <>
            <ul className="flex flex-wrap gap-2">
              {filters.map((f) => {
                const name = filterName(f)
                return (
                  <li key={f.dimension}>
                    <Link
                      href={trafficHref(path, state, {
                        filters: filters.filter((x) => x.dimension !== f.dimension),
                      })}
                      aria-label={t('removeFilter', { name })}
                      className="flex items-center gap-1.5 rounded-full border border-brand/50 bg-brand/10 px-2.5 py-0.5 hover:bg-brand/20"
                    >
                      {name}
                      <XIcon aria-hidden className="size-3.5" />
                    </Link>
                  </li>
                )
              })}
            </ul>
            <Link
              href={trafficHref(path, state, { filters: [] })}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t('clear')}
            </Link>
          </>
        )}
      </section>

      {!data.complete && (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          {t('incomplete')}
        </p>
      )}

      <section
        aria-label={t('tiles.label')}
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      >
        {tiles.map((tile) => (
          <Link
            key={tile.id}
            href={trafficHref(path, state, { metric: tile.id })}
            aria-current={tile.id === metric ? 'true' : undefined}
            className={cn(
              'flex flex-col gap-1 rounded-xl border bg-card p-4 hover:border-brand focus-visible:border-brand',
              tile.id === metric ? 'border-brand ring-1 ring-brand' : 'border-border',
            )}
          >
            <span className="text-sm text-muted-foreground">{t(`tiles.${tile.id}`)}</span>
            <span className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-semibold tabular-nums">{tile.value}</span>
              {tile.delta && (
                <span
                  className={cn(
                    'text-sm tabular-nums',
                    tile.delta.up ? 'text-ok' : 'text-muted-foreground',
                  )}
                >
                  {tile.delta.text}
                  <span className="sr-only"> {t('change', { change: tile.delta.c })}</span>
                </span>
              )}
            </span>
          </Link>
        ))}
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            {t('tiles.returning')}
            <InfoTip label={t('returningInfoLabel')} title={t('tiles.returning')}>
              {t('returningInfo')}
            </InfoTip>
          </span>
          <span className="font-display text-2xl font-semibold tabular-nums">
            {totals.returning === null ? '—' : percent.format(totals.returning)}
          </span>
          <span className="text-xs text-muted-foreground">
            {data.counting > 0
              ? t('returningSome', { count: data.counting, total: data.sources.length })
              : t('returningNone')}
          </span>
        </div>
      </section>

      <MetricChart
        metrics={[{ id: metric, label: t(`tiles.${metric}`), unit: 'count', points }]}
        marks={[]}
        labels={{
          current: t('chart.current'),
          previous: t('chart.previous'),
          emergency: t('chart.emergency'),
          asTable: t('chart.asTable'),
          time: t('chart.time'),
        }}
        locale={locale}
        timeZone={data.timeZone}
        bucket={data.period.bucket}
        span={periodId === 'today' ? '24h' : periodId}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {several && (
          <TrafficCard
            title={t('products')}
            lists={[listOf('product')]}
            context={context}
            note={[
              t('productsFoot', {
                shown: data.lists.product?.rows.length ?? 0,
                total: data.projects.length,
              }),
              data.without.length > 0 ? t('productsWithout', { count: data.without.length }) : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        )}
        <TrafficCard
          title={t('cards.sources')}
          lists={TRAFFIC_CARDS.sources.map(listOf)}
          context={context}
        />
        <TrafficCard
          title={t('cards.pages')}
          lists={TRAFFIC_CARDS.pages.map(listOf)}
          context={context}
        />
        <TrafficCard
          title={t('cards.places')}
          lists={TRAFFIC_CARDS.places.map(listOf)}
          context={context}
        />
        <TrafficCard
          title={t('cards.devices')}
          lists={TRAFFIC_CARDS.devices.map(listOf)}
          context={context}
        />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex max-w-2xl flex-col gap-1">
            <h2 className="text-base font-semibold">{t('events.title')}</h2>
            <p className="text-sm text-muted-foreground">
              {t.rich('events.body', {
                code: (chunks) => (
                  <code className="rounded bg-muted px-1 font-mono text-xs">{chunks}</code>
                ),
              })}
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href={path.replace(/\/traffic$/, '/usage')}>
              {t('events.open')}
              <ArrowRightIcon data-icon="inline-end" aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
