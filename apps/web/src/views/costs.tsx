import { AI_PRICES_DATE } from '@octadash/integrations'
import { TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { InfoTip } from '@/components/info-tip'
import { MetricChart } from '@/components/metric-chart'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { COST_PERIODS, type CostPeriodId, costsHref } from '@/lib/costs'
import { digitsOf, formatMoney, pointsBetween } from '@/lib/money'
import { percentChange } from '@/lib/period'
import { cn } from '@/lib/utils'
import { loadConnectionSetup } from '@/server/connection-setup'
import { loadCosts } from '@/server/costs'
import { AreaProductsPage } from './area-start'
import { AccountProducts, CostsStartView } from './area-start-accounts'
/**
 * Costs, as closed in the Costs canvas: spend, the month's forecast against
 * the budget, AI today against its average and the margin on top; the daily
 * chart; margin by product; spend by provider with how often each is read.
 */
export async function CostsView({
  orgId,
  projectIds,
  path,
  state,
  group,
  product,
}: {
  orgId: string
  projectIds: string[] | null
  /** "/all/costs", "/g/<slug>/costs", "/p/<slug>/costs". */
  path: string
  state: { period: CostPeriodId }
  group?: string
  product?: { name: string; slug: string }
}) {
  const [data, t, locale, format] = await Promise.all([
    loadCosts(orgId, projectIds, state),
    getTranslations('costsArea'),
    getLocale(),
    getFormatter(),
  ])
  const money = (minor: number) => formatMoney(minor, data.currency, locale, true)
  const pct = (value: number | null) =>
    value === null
      ? '–'
      : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)}%`
  const several = data.projects.length > 1
  const usd = (dollars: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: dollars < 10 ? 4 : 2,
    }).format(dollars)
  const setupOf = (slug: string) => `/p/${slug}/costs/setup`

  if (data.connected === 0 && data.aiCalls.calls === 0) {
    const setup = await loadConnectionSetup(orgId, data.projects, 'costs')
    const [first] = setup
    if (product && first) return <CostsStartView orgId={orgId} product={product} setup={first} />
    return (
      <AreaProductsPage
        title={t('title')}
        intro={
          group
            ? t('introGroup', { group, currency: data.currency })
            : t('intro', { currency: data.currency })
        }
      >
        <AccountProducts area="costs" setup={setup} folded={false} />
      </AreaProductsPage>
    )
  }

  const change = (now: number, before: number) => {
    const c = percentChange(now, before)
    return c === null || c === 0 ? null : { c, text: `${c > 0 ? '↑' : '↓'} ${Math.abs(c)}%` }
  }
  const marginDelta = (() => {
    const p = pointsBetween(
      data.totals.margin === null ? null : Math.round(data.totals.margin),
      data.previous.margin === null ? null : Math.round(data.previous.margin),
    )
    return p === null || p === 0
      ? null
      : { c: p, text: `${p > 0 ? '↑' : '↓'} ${Math.abs(p)} ${t('pts')}`, points: true }
  })()
  const aiChange = data.ai.average > 0 ? change(data.ai.today, data.ai.average) : null
  const budget = data.month.budget
  const over = budget !== null && budget.forecast > budget.amount
  const nearing = budget !== null && !over && budget.forecast >= (budget.amount * budget.warn) / 100
  const tiles: {
    id: 'spend' | 'forecast' | 'ai' | 'margin'
    value: string
    delta: { c: number; text: string; points?: boolean } | null
    /** True when up is bad: spend. */
    upIsBad: boolean
    note?: string
    warn?: boolean
  }[] = [
    {
      id: 'spend',
      value: money(data.totals.spend),
      delta: change(data.totals.spend, data.previous.spend),
      upIsBad: true,
    },
    {
      id: 'forecast',
      value: money(data.month.forecast),
      delta: null,
      upIsBad: true,
      note:
        budget === null
          ? t('tiles.noBudget')
          : !budget.all
            ? t('tiles.budgetSome', {
                count: budget.products,
                forecast: money(budget.forecast),
                budget: money(budget.amount),
              })
            : over
              ? t('tiles.overBudget', { budget: money(budget.amount) })
              : t('tiles.budget', { budget: money(budget.amount) }),
      warn: over || nearing,
    },
    {
      id: 'ai',
      value: money(data.ai.today),
      delta: aiChange,
      upIsBad: true,
      note:
        data.ai.top && several
          ? t('tiles.aiTop', {
              product: data.ai.top.name,
              times: format.number(data.ai.top.times, { maximumFractionDigits: 1 }),
            })
          : undefined,
    },
    { id: 'margin', value: pct(data.totals.margin), delta: marginDelta, upIsBad: false },
  ]

  const digits = digitsOf(data.currency)
  const major = (minor: number) => minor / 10 ** digits
  const offset = data.previousSeries.length - data.series.length
  const chartPoints = data.series.map((p, i) => {
    const before = data.previousSeries[i + offset]
    return {
      at: `${p.day}T12:00:00Z`,
      current: major(p.spend),
      previous: before ? major(before.spend) : null,
    }
  })

  const intro = product
    ? t('introOne', { product: product.name, currency: data.currency })
    : group
      ? t('introGroup', { group, currency: data.currency })
      : t('intro', { currency: data.currency })

  const unassigned = data.byProvider.reduce((n, p) => n + p.unassigned, 0)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{intro}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {product && (
            <Button asChild variant="outline" size="sm">
              <Link href={setupOf(product.slug)}>{t('setUp')}</Link>
            </Button>
          )}
          <nav aria-label={t('periodLabel')} className="flex rounded-lg border border-border p-0.5">
            {COST_PERIODS.map((id) => (
              <Link
                key={id}
                href={costsHref(path, { period: id })}
                aria-current={id === state.period ? 'true' : undefined}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground',
                  id === state.period && 'bg-secondary font-medium text-foreground',
                )}
              >
                {t(`periods.${id}`)}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {!data.complete && (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          {t('incomplete')}
        </p>
      )}
      {data.unconverted.length > 0 && (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          {t('unconverted', { currencies: data.unconverted.join(', ') })}
        </p>
      )}

      <section
        aria-label={t('tiles.label')}
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      >
        {tiles.map((tile) => {
          const good = tile.delta ? (tile.upIsBad ? tile.delta.c < 0 : tile.delta.c > 0) : false
          return (
            <div
              key={tile.id}
              className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4"
            >
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                {tile.id === 'spend' ? t(`tiles.spendOf.${state.period}`) : t(`tiles.${tile.id}`)}
                {(tile.id === 'forecast' || tile.id === 'margin') && (
                  <InfoTip
                    label={t(`tiles.${tile.id}InfoLabel`)}
                    title={t(`tiles.${tile.id}Title`)}
                  >
                    {t(`tiles.${tile.id}Info`)}
                  </InfoTip>
                )}
              </span>
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-display text-2xl font-semibold tabular-nums">
                  {tile.value}
                </span>
                {tile.delta && (
                  <span className={cn('text-sm tabular-nums', good ? 'text-ok' : 'text-error')}>
                    {tile.delta.text}
                    <span className="sr-only">
                      {' '}
                      {tile.delta.points
                        ? t('changePoints', { change: tile.delta.c })
                        : tile.id === 'ai'
                          ? t('changeAverage', { change: tile.delta.c })
                          : t('change', { change: tile.delta.c })}
                    </span>
                  </span>
                )}
              </span>
              {tile.note && (
                <span
                  className={cn(
                    'flex items-center gap-1 text-xs',
                    tile.warn ? 'font-medium text-error' : 'text-muted-foreground',
                  )}
                >
                  {tile.warn && <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />}
                  {tile.note}
                </span>
              )}
            </div>
          )
        })}
      </section>

      <MetricChart
        metrics={[
          {
            id: 'spend',
            label: t('chart.spend'),
            unit: 'count',
            currency: data.currency,
            points: chartPoints,
          },
        ]}
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
        bucket="day"
        span={state.period === '7d' ? '7d' : '30d'}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0">
          <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>
              <h2 className="text-base font-semibold">{t('table.title')}</h2>
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t('table.revenue')}</p>
          </CardHeader>
          <CardContent>
            <Table scrollLabel={t('table.title')}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('table.product')}</TableHead>
                  <TableHead className="text-right">{t('table.cost')}</TableHead>
                  <TableHead className="text-right">{t('table.revenueColumn')}</TableHead>
                  <TableHead className="text-right">{t('table.margin')}</TableHead>
                  <TableHead>{t('table.note')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byProduct.map((row) => (
                  <TableRow key={row.project.id}>
                    <TableCell className="font-medium">
                      <Link href={`/p/${row.project.slug}/costs`} className="hover:underline">
                        {row.project.name}
                      </Link>
                    </TableCell>
                    {row.connected ? (
                      <>
                        <TableCell className="text-right tabular-nums">{money(row.cost)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.revenue > 0 ? money(row.revenue) : '–'}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right tabular-nums',
                            row.margin !== null && row.margin < 0 && 'font-semibold text-error',
                          )}
                        >
                          {pct(row.margin)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {row.aiTimes !== null && (
                            <span className="inline-flex items-center gap-1 font-medium text-error">
                              <TriangleAlertIcon aria-hidden className="size-3.5" />
                              {t('table.aiTimes', {
                                times: format.number(row.aiTimes, { maximumFractionDigits: 1 }),
                              })}
                            </span>
                          )}
                          {row.aiTimes === null && row.budget && (
                            <span className="inline-flex items-center gap-1 font-medium text-error">
                              <TriangleAlertIcon aria-hidden className="size-3.5" />
                              {t(`table.budget.${row.budget}`)}
                            </span>
                          )}
                          {row.aiTimes === null &&
                            !row.budget &&
                            row.margin !== null &&
                            row.margin < 0 && (
                              <span className="font-medium text-error">{t('table.loss')}</span>
                            )}
                        </TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={4} className="text-right text-sm">
                        <Link
                          href={setupOf(row.project.slug)}
                          className="text-brand underline underline-offset-2"
                        >
                          {t('table.connect')}
                        </Link>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">{t('providers.title')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.byProvider.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('providers.empty')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {data.byProvider.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 py-2.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {t(`providers.how.${p.provider === 'fixed' ? 'fixed' : 'api'}`)} ·{' '}
                        {t(`providers.every.${p.every}`)}
                      </span>
                      {p.status === 'failing' && (
                        <span className="flex items-center gap-1 text-xs font-medium text-error">
                          <TriangleAlertIcon aria-hidden className="size-3.5" />
                          {t('providers.failing')}
                        </span>
                      )}
                      {p.status === 'importing' && (
                        <span className="text-xs text-muted-foreground">
                          {t('providers.importing')}
                        </span>
                      )}
                    </span>
                    <span className="font-display font-semibold tabular-nums">
                      {money(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {unassigned > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('providers.unassigned', { amount: money(unassigned) })}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {data.aiCalls.calls > 0 && (
        <Card className="min-w-0">
          <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
            <CardTitle>
              <h2 className="flex items-center gap-1 text-base font-semibold">
                {t('aiCalls.title')}
                <InfoTip label={t('aiCalls.infoLabel')} title={t('aiCalls.title')}>
                  {t('aiCalls.info', {
                    date: format.dateTime(new Date(AI_PRICES_DATE), { dateStyle: 'medium' }),
                  })}
                </InfoTip>
              </h2>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {t('aiCalls.total', {
                calls: data.aiCalls.calls,
                cost: usd(data.aiCalls.cost),
              })}
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Table scrollLabel={t('aiCalls.title')}>
              <TableHeader>
                <TableRow>
                  {several && <TableHead>{t('aiCalls.product')}</TableHead>}
                  <TableHead>{t('aiCalls.model')}</TableHead>
                  <TableHead className="text-right">{t('aiCalls.calls')}</TableHead>
                  <TableHead className="text-right">{t('aiCalls.input')}</TableHead>
                  <TableHead className="text-right">{t('aiCalls.output')}</TableHead>
                  <TableHead className="text-right">{t('aiCalls.cost')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.aiCalls.rows.map((row) => (
                  <TableRow key={`${row.projectId}:${row.provider}:${row.model}`}>
                    {several && (
                      <TableCell>
                        <Link
                          href={`/p/${row.product.slug}/costs`}
                          className="font-medium hover:underline"
                        >
                          {row.product.name}
                        </Link>
                      </TableCell>
                    )}
                    <TableCell>
                      <span className="flex flex-col">
                        <span className="font-medium">{row.model}</span>
                        {row.provider && (
                          <span className="text-xs text-muted-foreground">{row.provider}</span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {format.number(row.calls)}
                      {row.errors > 0 && (
                        <span className="block text-xs text-error">
                          {t('aiCalls.errors', { count: row.errors })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {format.number(row.inputTokens, { notation: 'compact' })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {format.number(row.outputTokens, { notation: 'compact' })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.unpriced === row.calls ? (
                        <span className="text-xs text-muted-foreground">
                          {t('aiCalls.noPrice')}
                        </span>
                      ) : (
                        usd(row.cost)
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.aiCalls.unpriced > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('aiCalls.unpriced', { count: data.aiCalls.unpriced })}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
