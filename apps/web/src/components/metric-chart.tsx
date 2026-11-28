'use client'

import { type ChartPoint, OverviewChart } from '@/components/overview-chart'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface Metric {
  id: string
  label: string
  /** How a value reads in the table: "1,234" or "320 ms". */
  unit: 'count' | 'ms'
  /** Values are amounts in this currency (major units), for the table. */
  currency?: string
  points: ChartPoint[]
}

export interface MetricChartLabels {
  current: string
  previous: string
  emergency: string
  asTable: string
  time: string
}

/**
 * The big chart of the Overview and the product page: one tab per metric, the
 * previous period dashed, emergency marks, and "Show as a table" with the same
 * numbers for screen readers and anyone who prefers them.
 */
export function MetricChart({
  metrics,
  marks,
  labels,
  locale,
  timeZone,
  bucket,
  span,
}: {
  metrics: Metric[]
  marks: { at: string; label: string }[]
  labels: MetricChartLabels
  locale: string
  timeZone: string
  bucket: 'hour' | 'day'
  span: '24h' | '7d' | '30d'
}) {
  const number = new Intl.NumberFormat(locale)
  const dateTime = new Intl.DateTimeFormat(
    locale,
    span === '24h'
      ? { timeStyle: 'short', timeZone }
      : { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone },
  )
  const format = (metric: Metric, value: number | null) =>
    value === null
      ? '–'
      : metric.currency
        ? new Intl.NumberFormat(locale, { style: 'currency', currency: metric.currency }).format(
            value,
          )
        : metric.unit === 'ms'
          ? `${number.format(value)} ms`
          : number.format(value)
  const first = metrics[0]
  if (!first) return null

  const body = (metric: Metric) => (
    <div className="flex flex-col gap-3">
      <OverviewChart
        points={metric.points}
        marks={marks}
        labels={{ current: labels.current, previous: labels.previous, title: metric.label }}
        locale={locale}
        timeZone={timeZone}
        bucket={bucket}
        span={span}
      />
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          {labels.asTable}
        </summary>
        <div className="mt-2 max-h-72 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labels.time}</TableHead>
                <TableHead className="text-right">{labels.current}</TableHead>
                <TableHead className="text-right">{labels.previous}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {metric.points.map((p) => (
                <TableRow key={p.at}>
                  <TableCell>{dateTime.format(new Date(p.at))}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {format(metric, p.current)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {format(metric, p.previous)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </div>
  )

  const legend = (
    <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      <li className="flex items-center gap-2">
        <span aria-hidden className="h-0.5 w-4 bg-brand" />
        {labels.current}
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden className="h-0 w-4 border-t border-dashed border-muted-foreground" />
        {labels.previous}
      </li>
      {marks.length > 0 && (
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-3 w-0 border-l border-dashed border-error" />
          {labels.emergency}
        </li>
      )}
    </ul>
  )

  if (metrics.length === 1) {
    return (
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{first.label}</h2>
          {legend}
        </CardHeader>
        <CardContent>{body(first)}</CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <Tabs defaultValue={first.id} className="gap-4">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            {metrics.map((m) => (
              <TabsTrigger key={m.id} value={m.id}>
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {legend}
        </CardHeader>
        <CardContent>
          {metrics.map((m) => (
            <TabsContent key={m.id} value={m.id}>
              {body(m)}
            </TabsContent>
          ))}
        </CardContent>
      </Tabs>
    </Card>
  )
}
