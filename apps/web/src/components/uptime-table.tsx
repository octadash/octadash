'use client'

import {
  ChevronRightIcon,
  CircleDashedIcon,
  CircleIcon,
  DiamondIcon,
  EllipsisIcon,
  PauseIcon,
  SearchIcon,
  TriangleIcon,
} from 'lucide-react'
import Link from 'next/link'
import { Fragment, type ReactNode, useState } from 'react'
import { pauseMonitorAction } from '@/actions/monitors'
import type { BarState, StateName } from '@/lib/uptime-board'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

export interface StateCell {
  name: StateName
  /** "Down 14 min · 502", "Slow · 2.4 s", "Called 40 s ago". */
  text: string
}

interface Cells {
  state: StateCell
  bars: BarState[]
  /** The bars in words, for screen readers: "Down on 2 of 45 days". */
  barsText: string
  uptime: string
  response: string
  cert: string
  certWarn: boolean
}

export interface MonitorLine extends Cells {
  id: string
  name: string
  /** "API", "Site", "Heartbeat". */
  kind: string
  paused: boolean
  editHref: string | null
}

export interface ProductLine extends Cells {
  id: string
  name: string
  /** "3 monitors". */
  count: string
  href: string
  addHref: string | null
  monitors: MonitorLine[]
}

export interface UptimeTableLabels {
  filters: string
  all: string
  down: string
  lateOrSlow: string
  paused: string
  search: string
  periods: string
  product: string
  now: string
  bars: string
  uptime: string
  response: string
  certificate: string
  actions: string
  expand: string
  collapse: string
  open: string
  add: string
  edit: string
  pause: string
  resume: string
  /** "# more products, all up". */
  more: string
  show: string
  /** "# products don't use Uptime", empty when there are none. */
  without: string
  nothing: string
}

type Filter = 'all' | 'down' | 'lateOrSlow' | 'paused'

const MATCH: Record<Filter, (state: StateName) => boolean> = {
  all: () => true,
  down: (s) => s === 'down',
  lateOrSlow: (s) => s === 'late' || s === 'slow',
  paused: (s) => s === 'paused',
}

/** Rows shown before "# more products, all up · Show". */
const SHOWN = 5

/**
 * The table of the Uptime board: one row per product with its worst monitor,
 * opened to its monitors, with filters by state, a search and the period.
 * Problems come first; the healthy rest folds away once the list is long.
 */
export function UptimeTable({
  products,
  periods,
  labels,
  open: openAtStart = false,
}: {
  products: ProductLine[]
  periods: { id: string; label: string; href: string; current: boolean }[]
  labels: UptimeTableLabels
  /** Start with every product open: the page of a single product. */
  open?: boolean
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<Set<string>>(
    () => new Set(openAtStart ? products.map((p) => p.id) : []),
  )
  const [showAll, setShowAll] = useState(false)
  const monitors = products.flatMap((p) => p.monitors)
  const count = (f: Filter) => monitors.filter((m) => MATCH[f](m.state.name)).length
  const q = query.trim().toLowerCase()
  const narrowing = filter !== 'all' || q !== ''

  const rows = products.flatMap((product) => {
    const nameMatches = product.name.toLowerCase().includes(q)
    const own = product.monitors.filter(
      (m) => MATCH[filter](m.state.name) && (nameMatches || m.name.toLowerCase().includes(q)),
    )
    return own.length > 0 ? [{ product, monitors: narrowing ? own : product.monitors }] : []
  })
  const problem = (p: ProductLine) => p.state.name !== 'up' && p.state.name !== 'paused'
  // Problems always show; healthy products fill up to SHOWN rows, the rest fold away.
  const problems = rows.filter((r) => problem(r.product)).length
  const shown = narrowing || showAll ? rows : rows.slice(0, Math.max(SHOWN, problems))
  const hidden = rows.length - shown.length
  const toggle = (id: string) =>
    setOpened((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={filter}
          onValueChange={(value) => value && setFilter(value as Filter)}
          aria-label={labels.filters}
        >
          {(['all', 'down', 'lateOrSlow', 'paused'] as const).map((f) => (
            <ToggleGroupItem
              key={f}
              value={f}
              className="gap-1.5 px-2.5 data-[state=on]:bg-secondary data-[state=on]:font-semibold"
            >
              {labels[f]} <span className="tabular-nums">{count(f)}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="relative min-w-56 flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.search}
            aria-label={labels.search}
            className="h-8 pl-8"
          />
        </div>
        <nav aria-label={labels.periods} className="flex rounded-md border border-input">
          {periods.map((p) => (
            <Link
              key={p.id}
              href={p.href}
              aria-current={p.current ? 'page' : undefined}
              className={cn(
                'px-2.5 py-1 text-sm first:rounded-l-md last:rounded-r-md hover:bg-secondary',
                p.current && 'bg-secondary font-semibold',
              )}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table className="min-w-[52rem]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-3">
                <span className="sr-only">{labels.expand}</span>
              </TableHead>
              <TableHead>{labels.product}</TableHead>
              <TableHead>{labels.now}</TableHead>
              <TableHead>{labels.bars}</TableHead>
              <TableHead className="text-right">{labels.uptime}</TableHead>
              <TableHead className="text-right">{labels.response}</TableHead>
              <TableHead className="text-right">{labels.certificate}</TableHead>
              <TableHead className="w-12 pr-3">
                <span className="sr-only">{labels.actions}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                  {labels.nothing}
                </TableCell>
              </TableRow>
            )}
            {shown.map(({ product, monitors: own }) => {
              const isOpen = narrowing || opened.has(product.id)
              return (
                <Fragment key={product.id}>
                  <TableRow>
                    <TableCell className="pl-3">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? labels.collapse : labels.expand}: ${product.name}`}
                        onClick={() => toggle(product.id)}
                        disabled={narrowing}
                      >
                        <ChevronRightIcon
                          className={cn('transition-transform', isOpen && 'rotate-90')}
                        />
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Link href={product.href} className="font-medium hover:text-brand">
                        {product.name}
                      </Link>{' '}
                      <span className="text-xs text-muted-foreground">{product.count}</span>
                    </TableCell>
                    <Row cells={product} />
                    <TableCell className="pr-3 text-right">
                      <Menu label={`${labels.actions}: ${product.name}`}>
                        <DropdownMenuItem asChild>
                          <Link href={product.href}>{labels.open}</Link>
                        </DropdownMenuItem>
                        {product.addHref && (
                          <DropdownMenuItem asChild>
                            <Link href={product.addHref}>{labels.add}</Link>
                          </DropdownMenuItem>
                        )}
                      </Menu>
                    </TableCell>
                  </TableRow>
                  {isOpen &&
                    own.map((m) => (
                      <TableRow key={m.id} className="bg-muted/30">
                        <TableCell className="pl-3" />
                        <TableCell className="pl-6">
                          {m.editHref ? (
                            <Link href={m.editHref} className="hover:text-brand">
                              {m.name}
                            </Link>
                          ) : (
                            m.name
                          )}{' '}
                          <span className="text-xs text-muted-foreground">· {m.kind}</span>
                        </TableCell>
                        <Row cells={m} />
                        <TableCell className="pr-3 text-right">
                          {m.editHref && (
                            <Menu label={`${labels.actions}: ${m.name}`}>
                              <DropdownMenuItem asChild>
                                <Link href={m.editHref}>{labels.edit}</Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => {
                                  const data = new FormData()
                                  data.set('monitorId', m.id)
                                  data.set('paused', String(!m.paused))
                                  void pauseMonitorAction(data)
                                }}
                              >
                                {m.paused ? labels.resume : labels.pause}
                              </DropdownMenuItem>
                            </Menu>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
        {(hidden > 0 || labels.without) && (
          <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
            {hidden > 0 && (
              <>
                {labels.more.replace('#', String(hidden))} ·{' '}
                <button
                  type="button"
                  className="text-brand underline underline-offset-2"
                  onClick={() => setShowAll(true)}
                >
                  {labels.show}
                </button>
                {labels.without && ' · '}
              </>
            )}
            {labels.without}
          </p>
        )}
      </div>
    </div>
  )
}

const ICON: Record<StateName, ReactNode> = {
  down: <TriangleIcon className="size-3 shrink-0 fill-current text-error" aria-hidden />,
  late: <DiamondIcon className="size-3 shrink-0 fill-current text-warn" aria-hidden />,
  slow: <DiamondIcon className="size-3 shrink-0 fill-current text-warn" aria-hidden />,
  up: <CircleIcon className="size-2.5 shrink-0 fill-current text-ok" aria-hidden />,
  waiting: <CircleDashedIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />,
  paused: <PauseIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />,
}

/** The cells a product and a monitor share: now, bars and numbers. */
function Row({ cells }: { cells: Cells }) {
  return (
    <>
      <TableCell>
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          {ICON[cells.state.name]}
          {cells.state.text}
        </span>
      </TableCell>
      <TableCell>
        <Bars bars={cells.bars} />
        <span className="sr-only">{cells.barsText}</span>
      </TableCell>
      <TableCell className="text-right tabular-nums">{cells.uptime}</TableCell>
      <TableCell className="text-right tabular-nums">{cells.response}</TableCell>
      <TableCell
        className={cn('text-right tabular-nums', cells.certWarn && 'font-medium text-warn')}
      >
        {cells.cert}
      </TableCell>
    </>
  )
}

const BAR_CLASS: Record<BarState, string> = {
  up: 'fill-ok',
  partial: 'fill-warn',
  down: 'fill-error',
  none: 'fill-muted-foreground/30',
}

/** One bar per hour or day. Decorative: the same facts are in words next to it. */
function Bars({ bars }: { bars: BarState[] }) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${bars.length * 4} 16`}
      preserveAspectRatio="none"
      className="h-4 w-full min-w-40"
    >
      {bars.map((bar, i) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions in time
          key={i}
          x={i * 4}
          y={0}
          width={3}
          height={16}
          rx={0.5}
          className={BAR_CLASS[bar]}
        />
      ))}
    </svg>
  )
}

function Menu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label}>
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}
