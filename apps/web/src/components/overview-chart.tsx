'use client'

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'

export interface ChartPoint {
  /** ISO time of the bucket start. */
  at: string
  current: number | null
  previous: number | null
}

export interface ChartLabels {
  current: string
  previous: string
  /** Shown as the accessible name of the chart. */
  title: string
}

/**
 * The big chart of the Overview: this period as an area, the previous one as a
 * dashed line, and a mark at each emergency. Decorative for screen readers: the
 * same numbers are in the table next to it.
 */
export function OverviewChart({
  points,
  marks,
  labels,
  locale,
  timeZone,
  bucket,
  span,
}: {
  points: ChartPoint[]
  marks: { at: string; label: string }[]
  labels: ChartLabels
  locale: string
  timeZone: string
  bucket: 'hour' | 'day'
  span: '24h' | '7d' | '30d'
}) {
  const config = {
    current: { label: labels.current, color: 'var(--brand)' },
    previous: { label: labels.previous, color: 'var(--muted-foreground)' },
  } satisfies ChartConfig
  // An hour on a day chart, a weekday and hour on a week, a date on a month.
  const tick = new Intl.DateTimeFormat(
    locale,
    span === '24h'
      ? { hour: 'numeric', timeZone }
      : span === '7d'
        ? { weekday: 'short', hour: 'numeric', timeZone }
        : { day: 'numeric', month: 'short', timeZone },
  )
  const full = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: bucket === 'hour' ? 'short' : undefined,
    timeZone,
  })
  // A mark falls on the bucket it happened in.
  const bucketOf = (iso: string) => {
    const at = new Date(iso).getTime()
    let found = points[0]?.at
    for (const p of points) if (new Date(p.at).getTime() <= at) found = p.at
    return found
  }

  // One mark per bucket, naming each product once.
  const byBucket = new Map<string, Set<string>>()
  for (const mark of marks) {
    const x = bucketOf(mark.at)
    if (!x) continue
    byBucket.set(x, (byBucket.get(x) ?? new Set()).add(mark.label))
  }
  // Labels need room: a mark close to the last labelled one keeps only its line.
  const index = new Map(points.map((p, i) => [p.at, i]))
  const gap = Math.max(1, Math.round(points.length / 8))
  let lastLabelled = Number.NEGATIVE_INFINITY
  const grouped = [...byBucket]
    .sort((a, b) => (index.get(a[0]) ?? 0) - (index.get(b[0]) ?? 0))
    .map(([x, names]) => {
      const i = index.get(x) ?? 0
      const labelled = i - lastLabelled >= gap
      if (labelled) lastLabelled = i
      // Near the right edge the label goes to the left of its line.
      const side = i > points.length * 0.7 ? 'insideTopRight' : 'insideTopLeft'
      return [x, labelled ? [...names].join(', ') : '', side] as const
    })

  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full" aria-hidden>
      <ComposedChart
        accessibilityLayer={false}
        data={points}
        margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="at"
          tickLine={false}
          axisLine={false}
          minTickGap={32}
          tickFormatter={(value: string) => tick.format(new Date(value))}
        />
        <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <ChartTooltip
          content={
            <ChartTooltipContent labelFormatter={(value) => full.format(new Date(String(value)))} />
          }
        />
        <Area
          dataKey="current"
          type="monotone"
          stroke="var(--color-current)"
          fill="var(--color-current)"
          fillOpacity={0.15}
          strokeWidth={2}
          isAnimationActive={false}
        />
        <Line
          dataKey="previous"
          type="monotone"
          stroke="var(--color-previous)"
          strokeDasharray="4 4"
          dot={false}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
        {grouped.map(([x, label, side]) => (
          <ReferenceLine
            key={x}
            x={x}
            stroke="var(--color-error)"
            strokeDasharray="3 3"
            label={{
              value: label,
              position: side,
              fill: 'var(--color-error)',
              fontSize: 12,
            }}
          />
        ))}
      </ComposedChart>
    </ChartContainer>
  )
}
