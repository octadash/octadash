'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

export interface ChartCheck {
  /** ISO time. */
  at: string
  up: boolean
  status: number | null
  ms: number | null
  /** "502", "Connection refused". */
  result: string
}

export interface EmergencyChartLabels {
  title: string
  response: string
  codes: string
  showTable: string
  hideTable: string
  time: string
  result: string
  ms: string
  code: string
  count: string
  /** "502 from 9:20 PM". */
  failure: string | null
  noChecks: string
}

const W = 600
const H = 140

/**
 * The monitor's checks around the emergency: response time as a line, failed
 * checks as red bars, and the moment it started failing. Every point is also
 * in the table under it.
 */
export function EmergencyChart({
  checks,
  from,
  to,
  failureAt,
  timeZone,
  locale,
  labels,
}: {
  checks: ChartCheck[]
  from: string
  to: string
  failureAt: string | null
  timeZone: string
  locale: string
  labels: EmergencyChartLabels
}) {
  const [table, setTable] = useState(false)
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone })
  const start = new Date(from).getTime()
  const span = Math.max(1, new Date(to).getTime() - start)
  const x = (at: string) => ((new Date(at).getTime() - start) / span) * W
  const max = Math.max(1, ...checks.map((c) => (c.up ? (c.ms ?? 0) : 0)))
  const y = (ms: number) => H - 8 - (ms / max) * (H - 24)
  const line = checks
    .filter((c) => c.up && c.ms !== null)
    .map((c, i) => `${i ? 'L' : 'M'}${x(c.at).toFixed(1)} ${y(c.ms ?? 0).toFixed(1)}`)
    .join(' ')
  const codes = [
    ...checks
      .reduce(
        (all, c) => all.set(c.result, (all.get(c.result) ?? 0) + 1),
        new Map<string, number>(),
      )
      .entries(),
  ].sort((a, b) => b[1] - a[1])

  return (
    <section
      aria-labelledby="chart-title"
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <Tabs defaultValue="response" className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="chart-title" className="font-semibold">
            {labels.title}
          </h2>
          <TabsList>
            <TabsTrigger value="response">{labels.response}</TabsTrigger>
            <TabsTrigger value="codes">{labels.codes}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="response">
          {checks.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">{labels.noChecks}</p>
          ) : (
            <svg
              aria-hidden
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              className="h-36 w-full"
            >
              {failureAt && (
                <>
                  <rect
                    x={x(failureAt)}
                    y={0}
                    width={Math.max(0, W - x(failureAt))}
                    height={H}
                    className="fill-error/10"
                  />
                  <line
                    x1={x(failureAt)}
                    x2={x(failureAt)}
                    y1={0}
                    y2={H}
                    strokeDasharray="4 3"
                    className="stroke-error"
                  />
                </>
              )}
              {checks
                .filter((c) => !c.up)
                .map((c) => (
                  <rect
                    key={c.at}
                    x={x(c.at) - 1}
                    y={H - 30}
                    width={2.5}
                    height={30}
                    className="fill-error"
                  />
                ))}
              <path d={line} fill="none" strokeWidth={1.5} className="stroke-brand" />
            </svg>
          )}
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{time.format(new Date(from))}</span>
            {labels.failure && <span className="font-medium text-error">{labels.failure}</span>}
            <span>{time.format(new Date(to))}</span>
          </div>
        </TabsContent>
        <TabsContent value="codes">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labels.code}</TableHead>
                <TableHead className="text-right">{labels.count}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.map(([code, count]) => (
                <TableRow key={code}>
                  <TableCell>{code}</TableCell>
                  <TableCell className="text-right tabular-nums">{count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>

      {checks.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-expanded={table}
            onClick={() => setTable(!table)}
            className="self-start text-sm text-brand underline underline-offset-2"
          >
            {table ? labels.hideTable : labels.showTable}
          </button>
          {table && (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{labels.time}</TableHead>
                    <TableHead>{labels.result}</TableHead>
                    <TableHead className="text-right">{labels.ms}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {checks.map((c) => (
                    <TableRow key={c.at}>
                      <TableCell className="tabular-nums">{time.format(new Date(c.at))}</TableCell>
                      <TableCell className={cn(!c.up && 'font-medium text-error')}>
                        {c.result}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.ms ?? '–'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
