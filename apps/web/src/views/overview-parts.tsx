import Link from 'next/link'
import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { duration } from '@/lib/duration'
import { PERIODS, type Period, type PeriodId, percentChange } from '@/lib/period'
import { cn } from '@/lib/utils'
import type { HourState, TimelineItem } from '@/server/overview'

export { duration }

/**
 * The pieces the Overview and the product page share, so both read the same:
 * the period header, the number tiles, sparklines, the bar of hours and the
 * "What happened" timeline.
 */

type Translate = (key: string, values?: Record<string, string | number>) => string

/** Formats in the reader's language and the organization's time zone. */
export function formats(locale: string, timeZone: string, period: PeriodId) {
  return {
    time: new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }),
    dateTime: new Intl.DateTimeFormat(
      locale,
      period === '24h'
        ? { timeStyle: 'short', timeZone }
        : { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone },
    ),
    number: new Intl.NumberFormat(locale),
    elapsed: (from: Date, to: Date) => duration(locale, to.getTime() - from.getTime()),
  }
}

export interface Delta {
  text: string
  up: boolean
  down: boolean
}

/** "+11%", "−35%", or null with nothing before to compare with. */
export function deltaOf(t: Translate, current: number, previous: number): Delta | null {
  const change = percentChange(current, previous)
  if (change === null) return null
  return {
    text: t('change', { change: `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}` }),
    up: change > 0,
    down: change < 0,
  }
}

/** "14 min", "2 h 5 min", "3 d". */
/** Title, subtitle and, on the right, the period, the comparison and who is online. */
export function PageHeader({
  title,
  subtitle,
  base,
  period,
  online,
  actions,
  t,
}: {
  title: string
  subtitle: string
  base: string
  period: Period
  online: number | null
  actions?: ReactNode
  t: Translate
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
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
          {t('vsPrevious', { period: t(`periods.${period.id}`) })}
        </span>
        {online !== null && (
          <span className="flex items-center gap-2 text-sm">
            <span aria-hidden className="size-2 rounded-full bg-ok" />
            {t('online', { count: online })}
          </span>
        )}
        {actions}
      </div>
    </div>
  )
}

export function Tile({
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
  delta?: Delta | null
  /** Left empty to keep tiles aligned when there is nothing to add. */
  sub?: string
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
        {area !== label && <span className="text-xs">{area}</span>}
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

export function Tiles({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,14rem),1fr))]"
    >
      {children}
    </section>
  )
}

export function Sparkline({ values, className }: { values: number[]; className?: string }) {
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

/** One cell per hour or day: green up, orange and taller down, gray without checks. */
export function HourBar({ hours, className }: { hours: HourState[]; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${hours.length * 5} 16`}
      preserveAspectRatio="none"
      className={cn('h-4 w-28 shrink-0', className)}
    >
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

/** A product's latest items in a timeline row; the rest are one click away. */
const TIMELINE_ITEMS = 5

/**
 * "What happened": one row per product (or per monitor on the product page)
 * that had something, a bar of the period with each item, and the same items
 * written out.
 */
export function Timeline({
  title,
  rows,
  period,
  quiet,
  t,
  format,
}: {
  title: string
  rows: { key: string; name: string; href: string; items: TimelineItem[] }[]
  period: Period
  /** The line under the timeline about rows with nothing, or null. */
  quiet: string | null
  t: Translate
  format: ReturnType<typeof formats>
}) {
  const total = period.to.getTime() - period.from.getTime()
  return (
    <section aria-labelledby="timeline-title" className="flex flex-col gap-3">
      <h2 id="timeline-title" className="text-lg font-semibold">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('timeline.nothing')}</p>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-4">
            {rows.map(({ key, name, href, items }) => (
              <div key={key} className="grid gap-2 md:grid-cols-[12rem_1fr] md:items-start">
                <Link href={href} className="font-medium hover:text-brand">
                  {name}
                </Link>
                <div className="flex flex-col gap-1">
                  <div aria-hidden className="relative h-4 rounded bg-secondary">
                    {items.map((item) => {
                      const start = item.from.getTime() - period.from.getTime()
                      const end = (item.to ?? period.to).getTime() - period.from.getTime()
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
                          from: format.dateTime.format(item.from),
                          to: item.to ? format.dateTime.format(item.to) : '',
                          duration: format.elapsed(item.from, item.to ?? period.to),
                        })}
                      </li>
                    ))}
                  </ul>
                  {items.length > TIMELINE_ITEMS && (
                    <Link href={href} className="text-sm text-brand hover:underline">
                      {t('timeline.more', { count: items.length - TIMELINE_ITEMS })}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {rows.length > 0 && quiet && <p className="text-sm text-muted-foreground">{quiet}</p>}
    </section>
  )
}

function kindKey(kind: string) {
  return [
    'monitor_down',
    'heartbeat_missed',
    'cert_expiring',
    'error_spike',
    'key_event_stopped',
    'log_alert',
    'payments_failing',
    'cost_runaway',
  ].includes(kind)
    ? kind
    : 'other'
}
