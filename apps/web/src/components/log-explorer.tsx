'use client'

import { ArrowUpIcon, ChevronRightIcon, SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react'
import { LOG_PAGE, levelTag, queryValue } from '@/lib/logs'
import { cn } from '@/lib/utils'
import type { ShownLine } from '@/server/logs'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Switch } from './ui/switch'

/** How often Live asks for new lines. */
const POLL_MS = 3000
/** Lines kept on screen; older ones fall off the bottom while Live runs. */
const MAX_LINES = 1000
/** Scrolled this far down, Live pauses so the line being read stays put. */
const PAUSE_AT_PX = 400

export interface LogExplorerLabels {
  search: string
  searchPlaceholder: string
  searchButton: string
  live: string
  liveOn: string
  paused: string
  backToTop: string
  newLines: string
  loadOlder: string
  noOlder: string
  loading: string
  failed: string
  attributes: string
  resource: string
  trace: string
  traceLines: string
  errorsInTrace: string
  span: string
  scope: string
  masked: string
  addToSearch: string
  empty: string
  time: string
  level: string
  service: string
  product: string
  source: string
  message: string
}

const LEVEL_CLASS: Record<string, string> = {
  FTL: 'border-error text-error',
  ERR: 'border-error text-error',
  WRN: 'border-warn text-warn',
}

/**
 * The search box, Live and the lines of the Logs canvas. The page renders the
 * first lines; Live asks for newer ones every few seconds and pauses while
 * the person scrolls down, and "Load older" pages back. A line opens to show
 * its attributes, with links to its trace and its error.
 */
export function LogExplorer({
  initial,
  scope,
  q,
  period,
  source,
  path,
  liveDefault,
  several,
  locale,
  timeZone,
  withDate,
  labels,
  saveButton,
  header,
}: {
  initial: ShownLine[]
  /** `all`, `g:<group>` or `p:<product>`. */
  scope: string
  q: string
  period: string
  /** The source the page is filtered to, or null for every source. */
  source: string | null
  /** The page's own address, for links that change the search. */
  path: string
  liveDefault: boolean
  /** More than one product in view: each line names its product. */
  several: boolean
  locale: string
  timeZone: string
  /** A week or more: times show the day too. */
  withDate: boolean
  labels: LogExplorerLabels
  saveButton: ReactNode
  /** The count, legend and histogram above the lines. */
  header: ReactNode
}) {
  const [lines, setLines] = useState(initial)
  const [live, setLive] = useState(liveDefault)
  const [paused, setPaused] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [older, setOlder] = useState<'idle' | 'loading' | 'done' | 'failed'>(
    initial.length < LOG_PAGE ? 'done' : 'idle',
  )
  const [announce, setAnnounce] = useState('')
  const lastAnnounce = useRef(0)
  const liveId = useId()
  const newest = lines[0]?.timestamp
  const oldest = lines.at(-1)?.timestamp

  useEffect(() => setLines(initial), [initial])

  const query = useCallback(
    (cursor: Record<string, string>) => {
      const params = new URLSearchParams({
        scope,
        q,
        period,
        ...(source ? { source } : {}),
        ...cursor,
      })
      return fetch(`/api/logs?${params}`, { cache: 'no-store' }).then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        return ((await response.json()) as { lines: ShownLine[] }).lines
      })
    },
    [scope, q, period, source],
  )

  useEffect(() => {
    const onScroll = () => setPaused(window.scrollY > PAUSE_AT_PX)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!live || paused) return
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const fresh = newest ? await query({ after: newest }) : await query({})
          if (!stop && fresh.length > 0) {
            setLines((current) => {
              const known = new Set(current.map(keyOf))
              const added = fresh.filter((l) => !known.has(keyOf(l)))
              return [...added, ...current].slice(0, MAX_LINES)
            })
            if (Date.now() - lastAnnounce.current > 15_000) {
              lastAnnounce.current = Date.now()
              setAnnounce(labels.newLines.replace('#', String(fresh.length)))
            }
          }
        } catch {
          // Asks again on the next round.
        }
      }
      if (!stop) timer = setTimeout(ask, POLL_MS)
    }
    timer = setTimeout(ask, POLL_MS)
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [live, paused, newest, query, labels.newLines])

  const loadOlder = async () => {
    if (!oldest) return
    setOlder('loading')
    try {
      const more = await query({ before: oldest })
      setLines((current) => [...current, ...more])
      setOlder(more.length < LOG_PAGE ? 'done' : 'idle')
    } catch {
      setOlder('failed')
    }
  }

  const time = new Intl.DateTimeFormat(locale, {
    ...(withDate ? { month: 'short', day: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
    timeZone,
  })
  const searchFor = (extra: string) => {
    const params = new URLSearchParams()
    if (period !== '24h') params.set('period', period)
    params.set('q', [q, extra].filter(Boolean).join(' '))
    if (source) params.set('source', source)
    return `${path}?${params}`
  }
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <search className="flex min-w-64 flex-1">
          <form action={path} className="flex flex-1 gap-2">
            {period !== '24h' && <input type="hidden" name="period" value={period} />}
            {!live && <input type="hidden" name="live" value="0" />}
            {source && <input type="hidden" name="source" value={source} />}
            <div className="relative flex-1">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                name="q"
                defaultValue={q}
                aria-label={labels.search}
                placeholder={labels.searchPlaceholder}
                className="pl-8 font-mono"
              />
            </div>
            <Button type="submit" variant="secondary">
              {labels.searchButton}
            </Button>
          </form>
        </search>
        {saveButton}
        <div className="flex items-center gap-2">
          <Switch id={liveId} checked={live} onCheckedChange={setLive} />
          <Label htmlFor={liveId}>{labels.live}</Label>
        </div>
      </div>

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-3 border-b px-4 py-3">{header}</div>
        {lines.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">{labels.empty}</p>
        ) : (
          <ul aria-label={labels.message} className="divide-y font-mono text-xs">
            {lines.map((line) => {
              const key = keyOf(line)
              const expanded = open.has(key)
              const tag = levelTag(line.level)
              const panel = `log-${key.replace(/[^\w-]/g, '')}`
              return (
                <li key={key}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panel}
                    onClick={() => toggle(key)}
                    className="grid w-full grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 px-4 py-2 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none sm:grid-cols-[auto_auto_6rem_auto_minmax(0,1fr)]"
                  >
                    <span className="flex items-center gap-1 text-muted-foreground tabular-nums">
                      <ChevronRightIcon
                        aria-hidden
                        className={cn('size-3 transition-transform', expanded && 'rotate-90')}
                      />
                      <time dateTime={line.timestamp}>{time.format(new Date(line.timestamp))}</time>
                    </span>
                    <span
                      className={cn(
                        'rounded border px-1 text-[0.65rem] font-semibold',
                        LEVEL_CLASS[tag] ?? 'border-border text-muted-foreground',
                      )}
                    >
                      <span className="sr-only">{labels.level}: </span>
                      {tag}
                    </span>
                    <span className="hidden truncate text-muted-foreground sm:block">
                      {line.service || '–'}
                    </span>
                    <span className="hidden truncate font-sans text-muted-foreground sm:block">
                      {[several ? line.product.name : '', line.source].filter(Boolean).join(' · ')}
                    </span>
                    <span className="col-span-3 truncate sm:col-span-1">{line.body}</span>
                  </button>
                  {expanded && (
                    <div id={panel} className="flex flex-col gap-3 bg-muted/30 px-4 py-3 pl-9">
                      <p className="font-sans text-sm break-words whitespace-pre-wrap">
                        {line.body}
                      </p>
                      <dl className="grid grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)] gap-x-6 gap-y-1">
                        <Row name={labels.service} value={line.service} />
                        {several && <Row name={labels.product} value={line.product.name} />}
                        {line.source && <Row name={labels.source} value={line.source} />}
                        {line.traceId && (
                          <>
                            <dt className="text-muted-foreground">{labels.trace}</dt>
                            <dd className="flex flex-wrap items-center gap-x-2 break-all">
                              <Link
                                href={searchFor(`trace:${line.traceId}`)}
                                className="text-brand underline-offset-2 hover:underline"
                              >
                                {line.traceId.slice(0, 8)}…
                              </Link>
                              <span className="font-sans text-muted-foreground">
                                {labels.traceLines}
                              </span>
                              {line.error && (
                                <Link
                                  href={line.error.href}
                                  className="font-sans text-brand underline-offset-2 hover:underline"
                                >
                                  · {labels.errorsInTrace.replace('#', String(line.error.count))}
                                </Link>
                              )}
                            </dd>
                          </>
                        )}
                        {line.spanId && <Row name={labels.span} value={line.spanId} />}
                        {line.scope && <Row name={labels.scope} value={line.scope} />}
                      </dl>
                      <Attributes
                        title={labels.attributes}
                        values={line.attributes}
                        addLabel={labels.addToSearch}
                        hrefOf={(k, v) => searchFor(`${k}:${queryValue(v)}`)}
                      />
                      <Attributes
                        title={labels.resource}
                        values={line.resource}
                        addLabel={labels.addToSearch}
                        hrefOf={(k, v) => searchFor(`${k}:${queryValue(v)}`)}
                      />
                      {line.masked > 0 && (
                        <p className="font-sans text-xs text-muted-foreground">
                          {labels.masked.replace('#', String(line.masked))}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
          <span aria-live="polite">
            {live ? (paused ? labels.paused : labels.liveOn) : ''}
            <span className="sr-only">{announce}</span>
          </span>
          <div className="flex items-center gap-2">
            {live && paused && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              >
                <ArrowUpIcon data-icon="inline-start" aria-hidden />
                {labels.backToTop}
              </Button>
            )}
            {lines.length > 0 &&
              (older === 'done' ? (
                <span>{labels.noOlder}</span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={older === 'loading'}
                  onClick={loadOlder}
                >
                  {older === 'loading'
                    ? labels.loading
                    : older === 'failed'
                      ? labels.failed
                      : labels.loadOlder}
                </Button>
              ))}
          </div>
        </div>
      </Card>
    </div>
  )
}

function keyOf(line: ShownLine) {
  return `${line.timestamp}|${line.projectId}|${line.spanId}|${line.body.slice(0, 40)}`
}

function Row({ name, value }: { name: string; value: string }) {
  if (!value) return null
  return (
    <>
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="break-all">{value}</dd>
    </>
  )
}

function Attributes({
  title,
  values,
  addLabel,
  hrefOf,
}: {
  title: string
  values: Record<string, string>
  addLabel: string
  hrefOf: (key: string, value: string) => string
}) {
  const entries = Object.entries(values).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return null
  return (
    <section className="flex flex-col gap-1">
      <h3 className="font-sans text-xs font-semibold text-muted-foreground">{title}</h3>
      <dl className="grid grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)] gap-x-6 gap-y-1">
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="flex items-baseline gap-2 break-all">
              <span>{value}</span>
              <Link
                href={hrefOf(key, value)}
                className="shrink-0 font-sans text-brand underline-offset-2 hover:underline"
                aria-label={`${addLabel}: ${key}:${value}`}
              >
                +
              </Link>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
