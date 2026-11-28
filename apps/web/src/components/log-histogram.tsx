'use client'

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export interface HistogramBar {
  /** ISO start of the slice. */
  at: string
  error: number
  warn: number
  info: number
}

/**
 * Lines per slice of the period, stacked by level as the Logs canvas draws
 * them. Decorative for screen readers: "Show as a table" has the numbers.
 */
export function LogHistogram({
  bars,
  labels,
  locale,
  timeZone,
  long,
}: {
  bars: HistogramBar[]
  labels: { error: string; warn: string; info: string; asTable: string; time: string }
  locale: string
  timeZone: string
  /** A week or more: ticks show the day. */
  long: boolean
}) {
  // Keys differ from the theme's --color-error and --color-warn, which the
  // container would otherwise redefine in terms of themselves.
  const config = {
    errors: { label: labels.error, color: 'var(--color-error)' },
    warnings: { label: labels.warn, color: 'var(--color-warn)' },
    others: { label: labels.info, color: 'var(--muted-foreground)' },
  } satisfies ChartConfig
  const data = bars.map((b) => ({ at: b.at, errors: b.error, warnings: b.warn, others: b.info }))
  const tick = new Intl.DateTimeFormat(
    locale,
    long ? { day: 'numeric', month: 'short', timeZone } : { hour: 'numeric', timeZone },
  )
  const full = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  })
  const number = new Intl.NumberFormat(locale)
  const withLines = bars.filter((b) => b.error + b.warn + b.info > 0)
  return (
    <div className="flex flex-col gap-2">
      <ChartContainer config={config} className="aspect-auto h-28 w-full" aria-hidden>
        <BarChart
          accessibilityLayer={false}
          data={data}
          margin={{ left: 0, right: 0, top: 4, bottom: 0 }}
          barCategoryGap={1}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="at"
            tickLine={false}
            axisLine={false}
            minTickGap={40}
            tickFormatter={(value: string) => tick.format(new Date(value))}
          />
          <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) => full.format(new Date(String(value)))}
              />
            }
          />
          <Bar dataKey="others" stackId="a" fill="var(--color-others)" isAnimationActive={false} />
          <Bar
            dataKey="warnings"
            stackId="a"
            fill="var(--color-warnings)"
            isAnimationActive={false}
          />
          <Bar dataKey="errors" stackId="a" fill="var(--color-errors)" isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          {labels.asTable}
        </summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labels.time}</TableHead>
                <TableHead className="text-right">{labels.error}</TableHead>
                <TableHead className="text-right">{labels.warn}</TableHead>
                <TableHead className="text-right">{labels.info}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {withLines.map((b) => (
                <TableRow key={b.at}>
                  <TableCell>{full.format(new Date(b.at))}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {number.format(b.error)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{number.format(b.warn)}</TableCell>
                  <TableCell className="text-right tabular-nums">{number.format(b.info)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </div>
  )
}
