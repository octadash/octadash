'use client'

import type { TrafficDimension, TrafficFilter, TrafficRow } from '@octadash/db'
import { ArrowRightIcon, DownloadIcon, SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useId, useMemo, useState } from 'react'
import {
  flagOf,
  shareOf,
  type TrafficMetric,
  type TrafficPeriodId,
  trafficHref,
  withFilters,
} from '@/lib/traffic'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader } from './ui/card'
import { Input } from './ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

/** What every list on the page shares: where its links point and how to name products. */
export interface TrafficContext {
  /** "/all/traffic", "/g/main/traffic", "/p/shop/traffic". */
  path: string
  /** For "Details": `all`, `g:<group>` or `p:<product>`. */
  scope: string
  state: { period: TrafficPeriodId; metric: TrafficMetric; filters: TrafficFilter[] }
  /** Product id to name. */
  products: Record<string, string>
  /** More than one product in scope: pages show whose they are. */
  several: boolean
  /** Visitors of the whole page, for the share of each row. */
  totalVisitors: number
}

export interface TrafficListData {
  dimension: TrafficDimension
  rows: TrafficRow[]
  total: number
}

/** Names a value the way people read it: "Direct / none", "🇧🇷 Brazil", "Acme Shop · /". */
function useLabel(context: TrafficContext) {
  const t = useTranslations('traffic')
  const locale = useLocale()
  const regions = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' })
    } catch {
      return null
    }
  }, [locale])
  const known = (key: string, value: string) =>
    t.has(`values.${key}.${value}`) ? t(`values.${key}.${value}`) : value
  return (dimension: TrafficDimension, row: TrafficRow) => {
    const v = row.value
    switch (dimension) {
      case 'product':
        return context.products[v] ?? v
      case 'channel':
        return known('channel', v)
      case 'source':
        return v || t('values.direct')
      case 'campaign':
        return v || t('values.none')
      case 'page':
      case 'entry': {
        const page = v || t('values.unknown')
        return row.product && context.several
          ? `${context.products[row.product] ?? ''} · ${page}`
          : page
      }
      case 'country':
        return v ? (regions?.of(v) ?? v) : t('values.unknown')
      case 'device':
        return v ? known('device', v) : t('values.unknown')
      case 'screen':
        return v ? known('screen', v) : t('values.unknown')
      default:
        return v || t('values.unknown')
    }
  }
}

/** The page's address with this row as a filter; a page row also keeps its product. */
function rowHref(context: TrafficContext, dimension: TrafficDimension, row: TrafficRow) {
  const added: TrafficFilter[] = [{ dimension, value: row.value }]
  if (row.product && context.several) added.unshift({ dimension: 'product', value: row.product })
  return trafficHref(context.path, context.state, {
    filters: withFilters(context.state.filters, added),
  })
}

function Leading({ dimension, row }: { dimension: TrafficDimension; row: TrafficRow }) {
  if (dimension === 'country') {
    const flag = flagOf(row.value)
    return flag ? <span aria-hidden>{flag}</span> : null
  }
  if (dimension === 'source') {
    return (
      <span
        aria-hidden
        className="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-[0.65rem] font-semibold uppercase text-muted-foreground"
      >
        {(row.value.replace(/^www\./, '')[0] ?? '↗') || '↗'}
      </span>
    )
  }
  return null
}

function Rows({
  dimension,
  rows,
  context,
}: {
  dimension: TrafficDimension
  rows: TrafficRow[]
  context: TrafficContext
}) {
  const t = useTranslations('traffic')
  const label = useLabel(context)
  const number = new Intl.NumberFormat(useLocale())
  const name = t(`dimensions.${dimension}`)
  return (
    <div className="flex flex-col">
      <div className="flex justify-between px-1 pb-1.5 text-xs text-muted-foreground">
        <span>{name}</span>
        <span>{t('visitors')}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => {
          const share = shareOf(row.visitors, context.totalVisitors)
          const text = label(dimension, row)
          return (
            <li key={`${row.product ?? ''}:${row.value}`}>
              <Link
                href={rowHref(context, dimension, row)}
                aria-label={t('filterBy', { dimension: name, value: text })}
                className="group relative flex items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-sm hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 rounded-md bg-brand/12"
                  style={{ width: `${share}%` }}
                />
                <span className="relative flex min-w-0 flex-1 items-center gap-2">
                  <Leading dimension={dimension} row={row} />
                  <span className="truncate group-hover:underline">{text}</span>
                </span>
                <span className="relative tabular-nums">{number.format(row.visitors)}</span>
                <span className="relative w-10 text-right text-xs text-muted-foreground tabular-nums">
                  {t('share', { share })}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** One card of lists with tabs: Channels, Sources, Campaigns; or Top pages, Entry pages. */
export function TrafficCard({
  title,
  lists,
  context,
  note,
}: {
  title: string
  lists: TrafficListData[]
  context: TrafficContext
  /** Replaces "184 sources" under the list. */
  note?: string
}) {
  const t = useTranslations('traffic')
  const titleId = useId()
  const first = lists[0]
  if (!first) return null
  const body = (list: TrafficListData) =>
    list.rows.length === 0 ? (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {context.state.filters.length > 0 ? t('emptyFiltered') : t('empty')}
      </p>
    ) : (
      <div className="flex flex-col gap-2">
        <Rows dimension={list.dimension} rows={list.rows} context={context} />
        <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span>{note ?? t(`count.${list.dimension}`, { count: list.total })}</span>
          <Details dimension={list.dimension} context={context} />
        </div>
      </div>
    )
  return (
    <Card className="gap-3">
      <CardHeader>
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
      </CardHeader>
      <CardContent>
        {lists.length === 1 ? (
          body(first)
        ) : (
          <Tabs defaultValue={first.dimension} className="gap-3">
            <TabsList aria-labelledby={titleId} className="h-auto flex-wrap">
              {lists.map((list) => (
                <TabsTrigger key={list.dimension} value={list.dimension}>
                  {t(`tabs.${list.dimension}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            {lists.map((list) => (
              <TabsContent key={list.dimension} value={list.dimension}>
                {body(list)}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CardContent>
    </Card>
  )
}

/** "Details": every value, with search, more on demand and a CSV of the same. */
function Details({ dimension, context }: { dimension: TrafficDimension; context: TrafficContext }) {
  const t = useTranslations('traffic')
  const label = useLabel(context)
  const number = new Intl.NumberFormat(useLocale())
  const searchId = useId()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<TrafficRow[]>([])
  const [more, setMore] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const name = t(`dimensions.${dimension}`)

  const params = (extra: Record<string, string>) => {
    const p = new URLSearchParams({
      scope: context.scope,
      period: context.state.period,
      dimension,
      ...extra,
    })
    for (const f of context.state.filters) p.append('f', `${f.dimension}:${f.value}`)
    return p.toString()
  }

  const load = async (offset: number, term: string) => {
    setState('loading')
    try {
      const response = await fetch(
        `/api/traffic?${params({ search: term, offset: String(offset) })}`,
      )
      if (!response.ok) throw new Error(String(response.status))
      const data = (await response.json()) as { rows: TrafficRow[]; more: boolean }
      setRows((before) => (offset === 0 ? data.rows : [...before, ...data.rows]))
      setMore(data.more)
      setState('idle')
    } catch {
      setState('failed')
    }
  }

  // Waits for a pause in typing before asking again.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloads when opened or the search settles
  useEffect(() => {
    if (open) void load(0, query)
  }, [open, query])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="link" size="sm" className="h-auto p-0 text-xs">
          {t('details')}
          <ArrowRightIcon data-icon="inline-end" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent closeLabel={t('close')} className="gap-3">
        <SheetHeader>
          <SheetTitle>{t('detailsTitle', { dimension: name })}</SheetTitle>
          <SheetDescription>{t('detailsIntro')}</SheetDescription>
        </SheetHeader>
        <div className="relative px-5">
          <label htmlFor={searchId} className="sr-only">
            {t('search', { dimension: name })}
          </label>
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-7.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={searchId}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('search', { dimension: name })}
            className="pl-8"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{name}</TableHead>
                <TableHead className="text-right">{t('visitors')}</TableHead>
                <TableHead className="text-right">{t('pageviews')}</TableHead>
                <TableHead className="w-12 text-right">%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.product ?? ''}:${row.value}`}>
                  <TableCell className="max-w-64">
                    <Link
                      href={rowHref(context, dimension, row)}
                      onClick={() => setOpen(false)}
                      className="block truncate hover:underline"
                    >
                      {label(dimension, row)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {number.format(row.visitors)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {number.format(row.pageviews)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {shareOf(row.visitors, context.totalVisitors)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p aria-live="polite" className="py-3 text-sm text-muted-foreground">
            {state === 'loading'
              ? t('loading')
              : state === 'failed'
                ? t('loadFailed')
                : rows.length === 0
                  ? t('empty')
                  : t('showing', { count: rows.length })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border p-5">
          {more && (
            <Button
              variant="outline"
              disabled={state === 'loading'}
              onClick={() => load(rows.length, query)}
            >
              {t('loadMore')}
            </Button>
          )}
          <Button asChild variant="ghost" className="ml-auto">
            <a href={`/api/traffic?${params({ search: query, format: 'csv' })}`} download>
              <DownloadIcon data-icon="inline-start" aria-hidden />
              {t('exportCsv')}
            </a>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
