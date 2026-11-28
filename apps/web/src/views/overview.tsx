import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { OverviewChart } from '@/components/overview-chart'
import { StatusDot } from '@/components/status-dot'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PERIODS, percentChange } from '@/lib/period'
import { cn } from '@/lib/utils'
import type { HourState, Overview, OverviewRow } from '@/server/overview'
import { formatUptime } from '@/server/uptime-view'

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
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone })
  const dateTime = new Intl.DateTimeFormat(
    locale,
    period.id === '24h'
      ? { timeStyle: 'short', timeZone }
      : { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone },
  )
  const number = new Intl.NumberFormat(locale)
  const elapsed = (from: Date, to: Date) => duration(locale, to.getTime() - from.getTime())
  const now = period.to

  const delta = (current: number, previous: number) => {
    const change = percentChange(current, previous)
    if (change === null) return null
    return {
      text: t('change', {
        change: `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}`,
      }),
      up: change > 0,
      down: change < 0,
    }
  }

  const quiet = rows.length - overview.timeline.length

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            {t('subtitle', {
              count: rows.length,
              period: t(`last.${period.id}`),
              time: time.format(now),
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label={t('period')} className="flex rounded-lg border border-border p-0.5">
            {PERIODS.map((id) => (
              <Link
                key={id}
                href={id === '24h' ? base : `${base}?period=${id}`}
                aria-current={id === period.id ? 'true' : undefined}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground',
                  id === period.id && 'bg-secondary font-medium text-foreground',
                )}
              >
                {t(`periods.${id}`)}
              </Link>
            ))}
          </nav>
          <span className="text-sm text-muted-foreground">
            {t('vsPrevious', { period: periodName })}
          </span>
          {traffic && (
            <span className="flex items-center gap-2 text-sm">
              <span aria-hidden className="size-2 rounded-full bg-ok" />
              {t('online', { count: traffic.online })}
            </span>
          )}
          {action}
        </div>
      </div>

      {!overview.complete && (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          {t('incomplete')}
        </p>
      )}

      {(uptime || traffic) && (
        <section
          aria-label={t('totals')}
          className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,14rem),1fr))]"
        >
          {uptime && (
            <Tile
              href={`${base}/uptime`}
              label={t('tiles.uptime')}
              area={tRoot('areas.uptime.name')}
              value={t('tiles.upNow', { up: uptime.upNow, total: uptime.products })}
              sub={t('tiles.uptimeSub', {
                ratio: formatUptime(uptime.ratio),
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
        </section>
      )}

      {traffic && (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>
              <h2 className="text-base font-semibold">{t('chart.visitors')}</h2>
            </CardTitle>
            <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <li className="flex items-center gap-2">
                <span aria-hidden className="h-0.5 w-4 bg-brand" />
                {t(`last.${period.id}`)}
              </li>
              <li className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="h-0 w-4 border-t border-dashed border-muted-foreground"
                />
                {t('chart.previous')}
              </li>
              {overview.marks.length > 0 && (
                <li className="flex items-center gap-2">
                  <span aria-hidden className="h-3 w-0 border-l border-dashed border-error" />
                  {t('chart.emergency')}
                </li>
              )}
            </ul>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <OverviewChart
              points={traffic.series.map((p, i) => ({
                at: p.at.toISOString(),
                current: p.visitors,
                previous: previousAt(traffic.previousSeries, traffic.series.length, i),
              }))}
              marks={overview.marks.map((m) => ({
                at: m.at.toISOString(),
                label: rows.find((r) => r.id === m.product)?.name ?? '',
              }))}
              labels={{
                current: t(`last.${period.id}`),
                previous: t('chart.previous'),
                title: t('chart.visitors'),
              }}
              locale={locale}
              timeZone={timeZone}
              bucket={period.chart}
              span={period.id}
            />
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                {t('chart.asTable')}
              </summary>
              <div className="mt-2 max-h-72 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('chart.time')}</TableHead>
                      <TableHead className="text-right">{t(`last.${period.id}`)}</TableHead>
                      <TableHead className="text-right">{t('chart.previous')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {traffic.series.map((p, i) => (
                      <TableRow key={p.at.toISOString()}>
                        <TableCell>{dateTime.format(p.at)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {number.format(p.visitors)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {number.format(
                            previousAt(traffic.previousSeries, traffic.series.length, i) ?? 0,
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          </CardContent>
        </Card>
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

      <section aria-labelledby="timeline-title" className="flex flex-col gap-3">
        <h2 id="timeline-title" className="text-lg font-semibold">
          {t('timeline.title', { period: periodName })}
        </h2>
        {overview.timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('timeline.nothing', { period: periodName })}
          </p>
        ) : (
          <Card>
            <CardContent className="flex flex-col gap-4">
              {overview.timeline.map(({ product, items }) => (
                <div
                  key={product.id}
                  className="grid gap-2 md:grid-cols-[12rem_1fr] md:items-center"
                >
                  <Link href={`/p/${product.slug}`} className="font-medium hover:text-brand">
                    {product.name}
                  </Link>
                  <div className="flex flex-col gap-1">
                    <div aria-hidden className="relative h-4 rounded bg-secondary">
                      {items.map((item) => {
                        const start = item.from.getTime() - period.from.getTime()
                        const end = (item.to ?? now).getTime() - period.from.getTime()
                        const total = now.getTime() - period.from.getTime()
                        return (
                          <span
                            key={`${item.incident}-${item.from.toISOString()}`}
                            className={cn(
                              'absolute inset-y-0 min-w-1 rounded',
                              item.kind === 'down' ? 'bg-error' : 'bg-warn',
                            )}
                            style={{
                              left: `${(start / total) * 100}%`,
                              width: `${(Math.max(end - start, 0) / total) * 100}%`,
                            }}
                          />
                        )
                      })}
                    </div>
                    <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
                      {items.slice(-TIMELINE_ITEMS).map((item) => (
                        <li key={`${item.incident}-${item.from.toISOString()}`}>
                          {t(`timeline.${item.to ? 'closed' : 'open'}`, {
                            what: t(`timeline.kinds.${kindKey(item.incident)}`, {
                              name: item.name ?? '',
                            }),
                            from: dateTime.format(item.from),
                            to: item.to ? dateTime.format(item.to) : '',
                            duration: elapsed(item.from, item.to ?? now),
                          })}
                        </li>
                      ))}
                    </ul>
                    {items.length > TIMELINE_ITEMS && (
                      <Link
                        href={`/p/${product.slug}`}
                        className="text-sm text-brand hover:underline"
                      >
                        {t('timeline.more', { count: items.length - TIMELINE_ITEMS })}
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        {overview.timeline.length > 0 && quiet > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('timeline.quiet', { count: quiet, period: periodName })}
          </p>
        )}
      </section>
    </>
  )
}

/** A product's latest items in the timeline; the rest are on its page. */
const TIMELINE_ITEMS = 5

/** The previous period's value for the same position, counted from the end. */
function previousAt(previous: { visitors: number }[], length: number, index: number) {
  const offset = previous.length - length
  return previous[index + offset]?.visitors ?? null
}

function kindKey(kind: string) {
  return ['monitor_down', 'heartbeat_missed', 'cert_expiring'].includes(kind) ? kind : 'other'
}

/** "14 min", "2 h 5 min", "3 d". */
function duration(locale: string, ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  const unit = (value: number, u: 'minute' | 'hour' | 'day') =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: u, unitDisplay: 'short' }).format(value)
  if (minutes < 60) return unit(minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    const rest = minutes % 60
    return rest > 0 ? `${unit(hours, 'hour')} ${unit(rest, 'minute')}` : unit(hours, 'hour')
  }
  return unit(Math.round(hours / 24), 'day')
}

function Tile({
  href,
  label,
  area,
  value,
  delta,
  sub,
  spark,
  alert,
}: {
  href: string
  label: string
  area: string
  value: string
  delta?: { text: string; up: boolean; down: boolean } | null
  sub: string
  spark: number[]
  alert?: boolean
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex flex-col gap-2 rounded-xl border bg-card p-4 hover:border-brand focus-visible:border-brand',
        alert ? 'border-error/60' : 'border-border',
      )}
    >
      <span className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        {label}
        <span className="text-xs">{area}</span>
      </span>
      <span className="flex items-baseline gap-2">
        <span className="font-display text-2xl font-semibold tabular-nums">{value}</span>
        {delta && (
          <span
            className={cn(
              'text-sm tabular-nums',
              delta.up && 'text-ok',
              delta.down && 'text-muted-foreground',
            )}
          >
            {delta.text}
          </span>
        )}
      </span>
      <span className="text-xs text-muted-foreground">{sub}</span>
      <Sparkline values={spark} className={alert ? 'text-error' : 'text-brand'} />
    </Link>
  )
}

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const width = 160
  const height = 32
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width
      const y = height - 2 - ((v - min) / range) * (height - 4)
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('h-8 w-full', className)}
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  )
}

function HourBar({ hours }: { hours: HourState[] }) {
  return (
    <svg aria-hidden viewBox={`0 0 ${hours.length * 5} 16`} className="h-4 w-28 shrink-0">
      {hours.map((h, i) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions in time
          key={i}
          x={i * 5}
          y={h === 'down' ? 0 : 3}
          width={4}
          height={h === 'down' ? 16 : 10}
          rx={1}
          className={
            h === 'down' ? 'fill-error' : h === 'up' ? 'fill-ok' : 'fill-muted-foreground/30'
          }
        />
      ))}
    </svg>
  )
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
  delta: { text: string; up: boolean; down: boolean } | null
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
