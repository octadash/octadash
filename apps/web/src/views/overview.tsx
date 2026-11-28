import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { MetricChart } from '@/components/metric-chart'
import { StatusDot } from '@/components/status-dot'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { digitsOf, formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { HourState, Overview, OverviewRow } from '@/server/overview'
import { formatUptime } from '@/server/uptime-view'
import {
  type Delta,
  deltaOf,
  formats,
  HourBar,
  PageHeader,
  Sparkline,
  Tile,
  Tiles,
  Timeline,
} from './overview-parts'

/**
 * The Overview of several products (every product or a group), as closed in
 * the panel canvas: numbers at the top with their trend, a big chart, the
 * table of products by area and "What happened". Areas show only where some
 * product uses them; "—" in the table means that product doesn't.
 */
export async function OverviewView({
  title,
  base,
  overview,
  action,
  top,
}: {
  title: string
  /** "/all" or "/g/<slug>": where the area links and the period links point. */
  base: string
  overview: Overview
  action?: ReactNode
  /** Above the numbers: the "Get started" list while it lasts. */
  top?: ReactNode
}) {
  const [t, tRoot, locale] = await Promise.all([
    getTranslations('overview'),
    getTranslations(),
    getLocale(),
  ])
  const { period, timeZone, rows, uptime, traffic, errors, signups, money, costs } = overview
  const periodName = t(`periods.${period.id}`)
  const format = formats(locale, timeZone, period.id)
  const { number, elapsed } = format
  const now = period.to
  const delta = (current: number, previous: number) => deltaOf(t, current, previous)
  /** For errors fewer is better: a drop reads as good, a rise does not. */
  const errorDelta = (current: number, previous: number) => {
    const d = deltaOf(t, current, previous)
    return d ? { ...d, up: d.down, down: d.up } : null
  }
  const quiet = rows.length - overview.timeline.length
  const moneyOf = (minor: number, currency: string) => formatMoney(minor, currency, locale, true)
  const percent = (value: number | null) => percentOf(value, locale)

  return (
    <>
      <PageHeader
        title={title}
        subtitle={t('subtitle', {
          count: rows.length,
          period: t(`last.${period.id}`),
          time: format.time.format(now),
        })}
        base={base}
        period={period}
        online={traffic ? traffic.online : null}
        actions={action}
        t={t}
      />

      {top}

      {!overview.complete && (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          {t('incomplete')}
        </p>
      )}

      {(uptime || traffic || errors || signups || money || costs) && (
        <Tiles label={t('totals')}>
          {uptime && (
            <Tile
              href={`${base}/uptime`}
              label={t('tiles.uptime')}
              area={tRoot('areas.uptime.name')}
              value={t('tiles.upNow', { up: uptime.upNow, total: uptime.products })}
              sub={t('tiles.uptimeSub', {
                ratio: formatUptime(uptime.ratio, locale),
                period: periodName,
              })}
              spark={uptime.spark}
              alert={uptime.upNow < uptime.products}
            />
          )}
          {traffic && (
            <Tile
              href={`${base}/traffic`}
              label={t('tiles.visitors')}
              area={tRoot('areas.traffic.name')}
              value={number.format(traffic.visitors)}
              delta={delta(traffic.visitors, traffic.previous)}
              sub={t('online', { count: traffic.online })}
              spark={traffic.series.map((p) => p.visitors)}
            />
          )}
          {errors && (
            <Tile
              href={`${base}/errors`}
              label={t('tiles.errors')}
              area={tRoot('areas.errors.name')}
              value={number.format(errors.events)}
              delta={errorDelta(errors.events, errors.previous)}
              sub={t('tiles.newIssues', { count: errors.newIssues })}
              spark={errors.series.map((p) => p.events)}
            />
          )}
          <AreaTiles overview={overview} base={base} t={t} tRoot={tRoot} locale={locale} />
        </Tiles>
      )}

      {(traffic || errors || signups || money) && (
        <MetricChart
          metrics={[
            ...(traffic
              ? [
                  {
                    id: 'visitors',
                    label: t('chart.visitors'),
                    unit: 'count' as const,
                    points: traffic.series.map((p, i) => ({
                      at: p.at.toISOString(),
                      current: p.visitors,
                      previous: previousAt(traffic.previousSeries, traffic.series.length, i),
                    })),
                  },
                ]
              : []),
            ...(errors
              ? [
                  {
                    id: 'errors',
                    label: t('chart.errors'),
                    unit: 'count' as const,
                    points: errors.series.map((p, i) => ({
                      at: p.at.toISOString(),
                      current: p.events,
                      previous: previousAt(
                        errors.previousSeries.map((q) => ({ visitors: q.events })),
                        errors.series.length,
                        i,
                      ),
                    })),
                  },
                ]
              : []),
            ...areaMetrics(overview, t),
          ]}
          marks={overview.marks.map((m) => ({
            at: m.at.toISOString(),
            label: rows.find((r) => r.id === m.product)?.name ?? '',
          }))}
          labels={chartLabels(t, period.id)}
          locale={locale}
          timeZone={timeZone}
          bucket={period.chart}
          span={period.id}
        />
      )}

      <section aria-labelledby="products-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="products-title" className="text-lg font-semibold">
            {t('table.title')}
          </h2>
          <span className="text-sm text-muted-foreground">{t('table.order')}</span>
        </div>
        <Card className="py-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4">{t('table.product')}</TableHead>
                  {uptime && <TableHead>{t('table.uptime', { period: periodName })}</TableHead>}
                  {traffic && <TableHead className="text-right">{t('table.visitors')}</TableHead>}
                  {errors && <TableHead className="text-right">{t('table.errors')}</TableHead>}
                  {signups && <TableHead className="text-right">{t('table.signups')}</TableHead>}
                  {money && <TableHead className="text-right">{t('table.revenue')}</TableHead>}
                  {costs && <TableHead className="text-right">{t('table.margin')}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <ProductRow
                    key={row.id}
                    row={row}
                    showUptime={Boolean(uptime)}
                    showTraffic={Boolean(traffic)}
                    showErrors={Boolean(errors)}
                    extra={[
                      ...(signups
                        ? [
                            row.signups
                              ? {
                                  value: number.format(row.signups.count),
                                  note: delta(row.signups.count, row.signups.previous)?.text ?? '',
                                }
                              : null,
                          ]
                        : []),
                      ...(money
                        ? [
                            row.money
                              ? {
                                  value: moneyOf(row.money.revenue, money.currency),
                                  note:
                                    row.money.mrr === null
                                      ? undefined
                                      : t('table.mrr', {
                                          mrr: moneyOf(row.money.mrr, money.currency),
                                        }),
                                }
                              : null,
                          ]
                        : []),
                      ...(costs
                        ? [
                            row.costs
                              ? {
                                  value: percent(row.costs.margin),
                                  note: t('table.cost', {
                                    cost: moneyOf(row.costs.cost, costs.currency),
                                  }),
                                  bad: row.costs.margin !== null && row.costs.margin < 0,
                                }
                              : null,
                          ]
                        : []),
                    ]}
                    errorsDelta={
                      row.errors ? errorDelta(row.errors.events, row.errors.previous) : null
                    }
                    issuesLabel={row.errors ? t('table.issues', { count: row.errors.issues }) : ''}
                    labels={{
                      down: row.emergency
                        ? t('table.downFor', { duration: elapsed(row.emergency.since, now) })
                        : row.status === 'down'
                          ? t('table.down')
                          : '',
                      takenBy: row.emergency?.takenBy
                        ? t('table.takenBy', { name: row.emergency.takenBy })
                        : '',
                      notUsed: t('table.notUsed'),
                      noChecks: t('table.noChecks'),
                      hours: (hours) =>
                        t('table.hoursSummary', {
                          down: hours.filter((h) => h === 'down').length,
                          total: hours.length,
                        }),
                    }}
                    number={number}
                    delta={row.traffic ? delta(row.traffic.visitors, row.traffic.previous) : null}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
        <div className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground">
          <span>{t('table.footnote')}</span>
          <span>{t('table.shown', { count: rows.length })}</span>
        </div>
      </section>

      <Timeline
        title={t('timeline.title', { period: periodName })}
        rows={overview.timeline.map(({ product, items }) => ({
          key: product.id,
          name: product.name,
          href: `/p/${product.slug}`,
          items,
        }))}
        period={period}
        quiet={quiet > 0 ? t('timeline.quiet', { count: quiet }) : null}
        t={t}
        format={format}
      />
    </>
  )
}

type Translator = (key: string, values?: Record<string, string | number>) => string

const percentOf = (value: number | null, locale: string) =>
  value === null
    ? '–'
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)}%`

/** Sign-ups, Revenue and Costs tiles, where some product uses those areas. */
export function AreaTiles({
  overview,
  base,
  t,
  tRoot,
  locale,
}: {
  overview: Overview
  base: string
  t: Translator
  tRoot: Translator
  locale: string
}) {
  const { period, signups, money, costs } = overview
  const periodName = t(`periods.${period.id}`)
  const number = new Intl.NumberFormat(locale)
  const delta = (current: number, previous: number) => deltaOf(t, current, previous)
  const errorDelta = (current: number, previous: number) => {
    const d = deltaOf(t, current, previous)
    return d ? { ...d, up: d.down, down: d.up } : null
  }
  const moneyOf = (minor: number, currency: string) => formatMoney(minor, currency, locale, true)
  const percent = (value: number | null) => percentOf(value, locale)
  return (
    <>
      {signups && (
        <Tile
          href={`${base}/usage`}
          label={t('tiles.signups')}
          area={tRoot('areas.usage.name')}
          value={number.format(signups.count)}
          delta={delta(signups.count, signups.previous)}
          sub={t('tiles.signupsSub', { period: periodName })}
          spark={signups.series.map((p) => p.count)}
        />
      )}
      {money && (
        <Tile
          href={`${base}/money`}
          label={t('tiles.revenue')}
          area={tRoot('areas.money.name')}
          value={moneyOf(money.revenue, money.currency)}
          delta={delta(money.revenue, money.previous)}
          sub={
            money.mrr === null
              ? undefined
              : t('tiles.mrr', { mrr: moneyOf(money.mrr, money.currency) })
          }
          spark={money.series.map((p) => p.revenue)}
        />
      )}
      {costs && (
        <Tile
          href={`${base}/costs`}
          label={t(period.id === '24h' ? 'tiles.costsToday' : 'tiles.costs')}
          area={tRoot('areas.costs.name')}
          value={moneyOf(costs.spend, costs.currency)}
          delta={errorDelta(costs.spend, costs.previous)}
          sub={t('tiles.margin', { margin: percent(costs.margin) })}
          spark={[]}
        />
      )}
    </>
  )
}

/** Sign-ups and Revenue for the big chart, where some product uses those areas. */
export function areaMetrics(overview: Overview, t: Translator) {
  const { signups, money } = overview
  const major = (minor: number, currency: string) => minor / 10 ** digitsOf(currency)
  return [
    ...(signups
      ? [
          {
            id: 'signups',
            label: t('chart.signups'),
            unit: 'count' as const,
            points: signups.series.map((p, i) => ({
              at: p.at.toISOString(),
              current: p.count,
              previous: previousAt(
                signups.previousSeries.map((q) => ({ visitors: q.count })),
                signups.series.length,
                i,
              ),
            })),
          },
        ]
      : []),
    ...(money
      ? [
          {
            id: 'revenue',
            label: t('chart.revenue'),
            unit: 'count' as const,
            currency: money.currency,
            points: money.series.map((p, i) => ({
              at: p.at.toISOString(),
              current: major(p.revenue, money.currency),
              previous: previousAt(
                money.previousSeries.map((q) => ({
                  visitors: major(q.revenue, money.currency),
                })),
                money.series.length,
                i,
              ),
            })),
          },
        ]
      : []),
  ]
}

export function chartLabels(
  t: (key: string, values?: Record<string, string | number>) => string,
  period: string,
) {
  return {
    current: t(`last.${period}`),
    previous: t('chart.previous'),
    emergency: t('chart.emergency'),
    asTable: t('chart.asTable'),
    time: t('chart.time'),
  }
}

/** The previous period's value for the same position, counted from the end. */
export function previousAt(previous: { visitors: number }[], length: number, index: number) {
  const offset = previous.length - length
  return previous[index + offset]?.visitors ?? null
}

function ProductRow({
  row,
  showUptime,
  showTraffic,
  showErrors,
  extra,
  errorsDelta,
  issuesLabel,
  labels,
  number,
  delta,
}: {
  row: OverviewRow
  showUptime: boolean
  showTraffic: boolean
  showErrors: boolean
  /** Sign-ups, Revenue · MRR and Margin, in order, when shown; null for "—". */
  extra: ({ value: string; note?: string; bad?: boolean } | null)[]
  errorsDelta: Delta | null
  issuesLabel: string
  labels: {
    down: string
    takenBy: string
    notUsed: string
    noChecks: string
    hours: (hours: HourState[]) => string
  }
  number: Intl.NumberFormat
  delta: Delta | null
}) {
  const dash = (
    <span className="text-muted-foreground">
      <span aria-hidden>—</span>
      <span className="sr-only">{labels.notUsed}</span>
    </span>
  )
  return (
    <TableRow className={cn('relative', row.emergency && 'bg-error/10 hover:bg-error/15')}>
      <TableCell className="px-4">
        <div className="flex items-center gap-3">
          <StatusDot status={row.status} />
          <div className="flex flex-col">
            {/* The link covers the row, so a click anywhere opens the product. */}
            <Link
              href={`/p/${row.slug}`}
              className="font-medium after:absolute after:inset-0 hover:text-brand"
            >
              {row.name}
            </Link>
            {(labels.down || labels.takenBy) && (
              <span className="text-xs text-error">
                {[labels.down, labels.takenBy].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        </div>
      </TableCell>
      {showUptime && (
        <TableCell>
          {row.uptime ? (
            <span className="flex items-center gap-3">
              <HourBar hours={row.uptime.hours} />
              <span
                className={cn(
                  'text-sm tabular-nums',
                  row.status === 'down' ? 'text-error' : 'text-muted-foreground',
                )}
              >
                {row.uptime.ratio === null
                  ? labels.noChecks
                  : formatUptime(row.uptime.ratio, number.resolvedOptions().locale)}
              </span>
              <span className="sr-only">{labels.hours(row.uptime.hours)}</span>
            </span>
          ) : (
            dash
          )}
        </TableCell>
      )}
      {showTraffic && (
        <TableCell className="text-right">
          {row.traffic ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-16">
                <Sparkline values={row.traffic.spark} className="text-brand" />
              </span>
              <span className="tabular-nums">{number.format(row.traffic.visitors)}</span>
              {delta && (
                <span
                  className={cn(
                    'w-12 text-xs tabular-nums',
                    delta.up ? 'text-ok' : 'text-muted-foreground',
                  )}
                >
                  {delta.text}
                </span>
              )}
            </span>
          ) : (
            dash
          )}
        </TableCell>
      )}
      {showErrors && (
        <TableCell className="text-right">
          {row.errors ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{issuesLabel}</span>
              <span className="tabular-nums">{number.format(row.errors.events)}</span>
              <span
                className={cn(
                  'w-12 text-xs tabular-nums',
                  errorsDelta?.up ? 'text-ok' : 'text-muted-foreground',
                )}
              >
                {errorsDelta?.text}
              </span>
            </span>
          ) : (
            dash
          )}
        </TableCell>
      )}
      {extra.map((cell, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the columns are fixed and in order
        <TableCell key={i} className="text-right">
          {cell ? (
            <span className="inline-flex flex-col items-end">
              <span className={cn('tabular-nums', cell.bad && 'font-semibold text-error')}>
                {cell.value}
              </span>
              {cell.note && (
                <span className="text-xs text-muted-foreground tabular-nums">{cell.note}</span>
              )}
            </span>
          ) : (
            dash
          )}
        </TableCell>
      ))}
    </TableRow>
  )
}
