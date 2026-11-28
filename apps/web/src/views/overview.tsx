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
}: {
  title: string
  /** "/all" or "/g/<slug>": where the area links and the period links point. */
  base: string
  overview: Overview
  action?: ReactNode
}) {
  const [t, tRoot, locale] = await Promise.all([
    getTranslations('overview'),
    getTranslations(),
    getLocale(),
  ])
  const { period, timeZone, rows, uptime, traffic } = overview
  const periodName = t(`periods.${period.id}`)
  const format = formats(locale, timeZone, period.id)
  const { number, elapsed } = format
  const now = period.to
  const delta = (current: number, previous: number) => deltaOf(t, current, previous)
  const quiet = rows.length - overview.timeline.length

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

      {!overview.complete && (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          {t('incomplete')}
        </p>
      )}

      {(uptime || traffic) && (
        <Tiles label={t('totals')}>
          {uptime && (
            <Tile
              href={`${base}/uptime`}
              label={t('tiles.uptime')}
              area={tRoot('areas.uptime.name')}
              value={t('tiles.upNow', { up: uptime.upNow, total: uptime.products })}
              sub={t('tiles.uptimeSub', { ratio: formatUptime(uptime.ratio), period: periodName })}
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
        </Tiles>
      )}

      {traffic && (
        <MetricChart
          metrics={[
            {
              id: 'visitors',
              label: t('chart.visitors'),
              unit: 'count',
              points: traffic.series.map((p, i) => ({
                at: p.at.toISOString(),
                current: p.visitors,
                previous: previousAt(traffic.previousSeries, traffic.series.length, i),
              })),
            },
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <ProductRow
                    key={row.id}
                    row={row}
                    showUptime={Boolean(uptime)}
                    showTraffic={Boolean(traffic)}
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
  labels,
  number,
  delta,
}: {
  row: OverviewRow
  showUptime: boolean
  showTraffic: boolean
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
                {row.uptime.ratio === null ? labels.noChecks : formatUptime(row.uptime.ratio)}
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
    </TableRow>
  )
}
