import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { InfoTip } from '@/components/info-tip'
import { LatestPayments } from '@/components/latest-payments'
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
import {
  digitsOf,
  formatMoney,
  MONEY_PERIODS,
  type MoneyMetric,
  type MoneyState,
  moneyHref,
  pointsBetween,
} from '@/lib/money'
import { percentChange } from '@/lib/period'
import { cn } from '@/lib/utils'
import { loadMoney } from '@/server/money'

const GATEWAYS = { stripe: 'Stripe', asaas: 'Asaas', paddle: 'Paddle' }

/**
 * Money, as closed in the Money canvas: revenue, MRR, new subscriptions,
 * churn and failed payments on top, the chart, every product with its
 * failures now, and the latest payments live. Totals are in the
 * organization's currency, each payment converted at its day's rate.
 */
export async function MoneyView({
  orgId,
  projectIds,
  path,
  scope,
  state,
  group,
  product,
}: {
  orgId: string
  projectIds: string[] | null
  /** "/all/money", "/g/<slug>/money", "/p/<slug>/money". */
  path: string
  /** For the browser's requests: `all`, `g:<slug>` or `p:<slug>`. */
  scope: string
  state: MoneyState
  group?: string
  product?: { name: string; slug: string }
}) {
  const [data, t, locale] = await Promise.all([
    loadMoney(orgId, projectIds, state),
    getTranslations('moneyArea'),
    getLocale(),
  ])
  const money = (minor: number) => formatMoney(minor, data.currency, locale, true)
  const pct = (value: number | null, digits = 1) =>
    value === null
      ? '–'
      : new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value) + '%'
  const several = data.projects.length > 1

  if (data.connected === 0) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
        <Card>
          <CardContent className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{t('none.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('none.body')}</p>
            <p className="text-sm text-muted-foreground">{t('none.readOnly')}</p>
            {product ? (
              <Button asChild className="self-start">
                <Link href={`/p/${product.slug}/money/setup`}>{t('none.connect')}</Link>
              </Button>
            ) : (
              <>
                <p className="text-sm font-medium">{t('none.all')}</p>
                <ul className="flex flex-wrap gap-2">
                  {data.projects.map((p) => (
                    <li key={p.id}>
                      <Button asChild variant="outline">
                        <Link href={`/p/${p.slug}/money/setup`}>{p.name}</Link>
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

  const change = (now: number, before: number) => {
    const c = percentChange(now, before)
    return c === null || c === 0 ? null : { c, text: `${c > 0 ? '↑' : '↓'} ${Math.abs(c)}%` }
  }
  const points = (now: number | null, before: number | null) => {
    const p = pointsBetween(now, before)
    return p === null || p === 0
      ? null
      : { c: p, text: `${p > 0 ? '↑' : '↓'} ${Math.abs(p)} ${t('pts')}`, points: true }
  }

  const tiles: {
    id: MoneyMetric | 'started' | 'churn' | 'failed'
    value: string
    delta: { c: number; text: string; points?: boolean } | null
    /** True when up is bad (churn, failures). */
    upIsBad?: boolean
    note?: string
  }[] = [
    {
      id: 'revenue',
      value: money(data.totals.revenue),
      delta: change(data.totals.revenue, data.previous.revenue),
      note:
        data.totals.refunded > 0
          ? t('tiles.refunded', { amount: money(data.totals.refunded) })
          : undefined,
    },
    { id: 'mrr', value: money(data.totals.mrr), delta: change(data.totals.mrr, data.previous.mrr) },
    {
      id: 'started',
      value: new Intl.NumberFormat(locale).format(data.totals.started),
      delta: change(data.totals.started, data.previous.started),
    },
    {
      id: 'churn',
      value: pct(data.totals.churn),
      delta: points(data.totals.churn, data.previous.churn),
      upIsBad: true,
    },
    {
      id: 'failed',
      value: pct(data.totals.failed),
      delta: points(data.totals.failed, data.previous.failed),
      upIsBad: true,
      note:
        data.failingNow && several
          ? t('tiles.failingNow', {
              product: data.failingNow.name,
              share: pct(data.failingNow.share, 0),
            })
          : undefined,
    },
  ]

  const digits = digitsOf(data.currency)
  const major = (minor: number) => minor / 10 ** digits
  const offset = data.previousSeries.length - data.series.length
  const chartPoints = data.series.map((p, i) => ({
    at: p.at.toISOString(),
    current: major(p[state.metric]),
    previous:
      data.previousSeries[i + offset] !== undefined
        ? major((data.previousSeries[i + offset] as (typeof data.series)[number])[state.metric])
        : null,
  }))

  const intro = product
    ? t('introOne', { product: product.name, currency: data.currency })
    : group
      ? t('introGroup', { group, currency: data.currency })
      : t('intro', { currency: data.currency })

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
              <Link href={`/p/${product.slug}/money/setup`}>{t('setUp')}</Link>
            </Button>
          )}
          <nav aria-label={t('periodLabel')} className="flex rounded-lg border border-border p-0.5">
            {MONEY_PERIODS.map((id) => (
              <Link
                key={id}
                href={moneyHref(path, state, { period: id })}
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
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5"
      >
        {tiles.map((tile) => {
          const good = tile.delta ? (tile.upIsBad ? tile.delta.c < 0 : tile.delta.c > 0) : false
          const body = (
            <>
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                {t(`tiles.${tile.id}`)}
                {(tile.id === 'mrr' || tile.id === 'churn') && (
                  <InfoTip label={t(`tiles.${tile.id}InfoLabel`)} title={t(`tiles.${tile.id}`)}>
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
                        : t('change', { change: tile.delta.c })}
                    </span>
                  </span>
                )}
              </span>
              {tile.note && <span className="text-xs text-muted-foreground">{tile.note}</span>}
            </>
          )
          return tile.id === 'revenue' || tile.id === 'mrr' ? (
            <Link
              key={tile.id}
              href={moneyHref(path, state, { metric: tile.id })}
              aria-current={tile.id === state.metric ? 'true' : undefined}
              className={cn(
                'flex flex-col gap-1 rounded-xl border bg-card p-4 hover:border-brand focus-visible:border-brand',
                tile.id === state.metric ? 'border-brand ring-1 ring-brand' : 'border-border',
              )}
            >
              {body}
            </Link>
          ) : (
            <div
              key={tile.id}
              className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4"
            >
              {body}
            </div>
          )
        })}
      </section>

      <MetricChart
        metrics={[
          {
            id: state.metric,
            label: t(`tiles.${state.metric}`),
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
        bucket={data.period.bucket}
        span={state.period === 'today' ? '24h' : state.period}
      />

      <div className={cn('grid gap-6', several && 'lg:grid-cols-[minmax(0,1fr)_24rem]')}>
        {several && (
          <Card className="min-w-0">
            <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
              <CardTitle>
                <h2 className="text-base font-semibold">{t('table.title')}</h2>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{t('table.margin')}</p>
            </CardHeader>
            <CardContent>
              <Table scrollLabel={t('table.title')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('table.product')}</TableHead>
                    <TableHead className="text-right">{t('table.mrr')}</TableHead>
                    <TableHead className="text-right">{t('table.change')}</TableHead>
                    <TableHead className="text-right">{t('table.today')}</TableHead>
                    <TableHead className="text-right">{t('table.paying')}</TableHead>
                    <TableHead className="text-right">{t('table.failedNow')}</TableHead>
                    <TableHead className="text-right">{t('table.churn')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byProduct.map((row) => (
                    <TableRow key={row.project.id}>
                      <TableCell className="font-medium">
                        <Link href={`/p/${row.project.slug}/money`} className="hover:underline">
                          {row.project.name}
                        </Link>
                      </TableCell>
                      {row.connected ? (
                        <>
                          <TableCell className="text-right tabular-nums">
                            {row.mrr > 0 ? money(row.mrr) : '–'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.mrrChange === null
                              ? '–'
                              : `${row.mrrChange > 0 ? '+' : row.mrrChange < 0 ? '−' : ''}${Math.abs(row.mrrChange)}%`}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {money(row.today)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {new Intl.NumberFormat(locale).format(row.paying)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'text-right tabular-nums',
                              (row.failedNow ?? 0) >= 20 && 'font-semibold text-error',
                            )}
                          >
                            {pct(row.failedNow, 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {pct(row.churn)}
                          </TableCell>
                        </>
                      ) : (
                        <TableCell colSpan={6} className="text-right text-sm">
                          <Link
                            href={`/p/${row.project.slug}/money/setup`}
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
        )}
        <Card className="h-fit">
          <CardContent>
            <LatestPayments
              initial={data.latest.map((p) => ({ ...p, at: p.at.toISOString() }))}
              scope={scope}
              several={several}
              locale={locale}
              timeZone={data.timeZone}
              labels={{
                title: t('latest.title'),
                live: t('latest.live'),
                empty: t('latest.empty'),
                newPayments: t('latest.newPayments'),
                status: {
                  paid: t('status.paid'),
                  failed: t('status.failed'),
                  refunded: t('status.refunded'),
                  pending: t('status.pending'),
                  overdue: t('status.overdue'),
                  canceled: t('status.canceled'),
                },
                gateways: GATEWAYS,
              }}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
