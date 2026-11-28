'use client'

import {
  ActivityIcon,
  ArrowRightIcon,
  BugIcon,
  CheckIcon,
  ClockIcon,
  InfoIcon,
  ReceiptIcon,
  ShieldAlertIcon,
  TerminalIcon,
  TriangleAlertIcon,
  TriangleIcon,
  UserIcon,
  WalletIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useId, useRef, useState, useTransition } from 'react'
import { takeEmergenciesAction } from '@/actions/emergencies'
import { duration } from '@/lib/duration'
import {
  controlsSeen,
  filterItems,
  LIST_FIRST,
  NAMES_UP_TO,
  type StripData,
  type StripFilter,
  type StripItem,
  type StripKind,
  type StripSort,
  sortItems,
  stripSummary,
  takerLine,
  visibleItems,
  visibleResolved,
} from '@/lib/emergency-strip'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

/** The strip keeps its own colors in both themes: solid, with dark text (AA on both). */
const INK = 'text-[#0b0d12]'
const SOLID = cn(
  'h-8 bg-[#0b0d12] px-3 text-white hover:bg-[#0b0d12]/85',
  'focus-visible:ring-2 focus-visible:ring-[#0b0d12] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FF6B3D]',
)
const OUTLINE = cn(
  'h-8 border border-[#0b0d12]/70 bg-transparent px-3 text-[#0b0d12] hover:bg-black/10 hover:text-[#0b0d12]',
  'focus-visible:ring-2 focus-visible:ring-[#0b0d12] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FF6B3D]',
)

/** The chosen filter reads as chosen without relying on the fill alone. */
const ON = 'data-[state=on]:border-brand data-[state=on]:text-brand'

const KIND_ICON: Record<StripKind, typeof ActivityIcon> = {
  monitor_down: ActivityIcon,
  heartbeat_missed: ClockIcon,
  cert_expiring: ShieldAlertIcon,
  error_spike: BugIcon,
  key_event_stopped: UserIcon,
  log_alert: TerminalIcon,
  payments_failing: WalletIcon,
  cost_runaway: ReceiptIcon,
  other: TriangleAlertIcon,
}

/** "I'm on it" for one emergency or many, with the error the server gives. */
function useTake() {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string>()
  const take = (ids: string[], then?: () => void) => {
    const form = new FormData()
    for (const id of ids) form.append('incident', id)
    startTransition(async () => {
      const result = await takeEmergenciesAction(undefined, form)
      setError(result?.error)
      if (!result?.error) then?.()
    })
  }
  return { take, pending, error }
}

/** The clock of the server, moved forward every few seconds in the browser. */
function useServerNow(serverNow: number) {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const offset = serverNow - Date.now()
    setNow(serverNow)
    const timer = setInterval(() => setNow(Date.now() + offset), 5000)
    return () => clearInterval(timer)
  }, [serverNow])
  return now
}

/**
 * On top of every screen, ignoring the product picker: every open emergency
 * of the organization, as closed in the Emergencies canvas. One names the
 * product and what happened; a few list their names; many count, with what
 * they share as a hint (never merged). Green for ten seconds when one ends.
 */
export function EmergencyStrip({ data }: { data: StripData }) {
  const t = useTranslations('strip')
  const locale = useLocale()
  const now = useServerNow(data.serverNow)
  const items = sortItems(visibleItems(data.items, now), 'oldest')
  const ended = visibleResolved(data.resolved, now)
  const since = (at: number) => duration(locale, now - at)

  // Screen readers hear what is new, once; the minutes ticking are not read.
  const [alert, setAlert] = useState('')
  const [status, setStatus] = useState('')
  const seen = useRef<{ open: Set<string>; ended: Set<string> } | null>(null)
  const openKey = items.map((i) => i.id).join()
  const endedKey = ended.map((r) => r.id).join()
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the sets change
  useEffect(() => {
    const open = new Set(items.map((i) => i.id))
    const done = new Set(ended.map((r) => r.id))
    if (seen.current) {
      const added = items.filter((i) => !seen.current?.open.has(i.id))
      if (added.length === 1) setAlert(t('newOne', { title: (added[0] as StripItem).title }))
      else if (added.length > 1) setAlert(t('newMany', { count: added.length }))
      const back = ended.filter((r) => !seen.current?.ended.has(r.id))
      if (back.length > 0) setStatus(back.map((r) => r.title).join('. '))
    }
    seen.current = { open, ended: done }
  }, [openKey, endedKey])

  let strip: ReactNode = null
  if (items.length === 1) {
    const item = items[0] as StripItem
    strip = (
      <Bar
        tone="error"
        label={t('label')}
        title={item.title}
        detail={`${item.detail} · ${since(item.startedAt)}`}
        actions={
          <>
            <Button asChild size="sm" className={SOLID}>
              <Link href={item.href}>{t('see')}</Link>
            </Button>
            {item.taker ? (
              <Taker>
                {item.taker.id === data.me
                  ? t('onItYou', { duration: since(item.taker.at) })
                  : t('onIt', { name: item.taker.name, duration: since(item.taker.at) })}
              </Taker>
            ) : (
              <TakeOne id={item.id} label={t('imOnIt')} />
            )}
          </>
        }
      />
    )
  } else if (items.length > 1) {
    const summary = stripSummary(items)
    const oldest = t('oldest', { duration: since(summary.oldestAt) })
    const detail =
      items.length <= NAMES_UP_TO
        ? [...items.map((i) => i.short), oldest].join(' · ')
        : [
            summary.togetherMinutes !== null && t('together', { minutes: summary.togetherMinutes }),
            summary.shared &&
              t('shared', { count: summary.shared.ids.length, ip: summary.shared.ip }),
            oldest,
          ]
            .filter(Boolean)
            .join(' · ')
    const line = takerLine(items, data.me)
    strip = (
      <Bar
        tone="error"
        label={t('label')}
        title={
          items.length > NAMES_UP_TO && summary.products < items.length
            ? t('countProducts', { count: items.length, products: summary.products })
            : t('count', { count: items.length })
        }
        detail={detail}
        actions={
          <>
            <SeeAll data={data} items={items} now={now} />
            <Taker className="hidden sm:inline-flex">
              {line.kind === 'nobody'
                ? t('nobody')
                : line.kind === 'you'
                  ? t('onSomeYou', { count: line.count, total: items.length })
                  : line.kind === 'one'
                    ? t('onSome', { name: line.name, count: line.count, total: items.length })
                    : t('onSomeSeveral', { count: line.count, total: items.length })}
            </Taker>
          </>
        }
      />
    )
  } else if (ended[0]) {
    const last = ended[0]
    strip = (
      <Bar
        tone="ok"
        label={t('label')}
        title={last.title}
        detail={
          last.taker
            ? t('backDetailTaker', { duration: duration(locale, last.lastedMs), name: last.taker })
            : t('backDetail', { duration: duration(locale, last.lastedMs) })
        }
        actions={
          <Button asChild size="sm" className={SOLID}>
            <Link href={last.href}>{t('seeWhat')}</Link>
          </Button>
        }
      />
    )
  }

  return (
    <>
      <div role="alert" className="sr-only">
        {alert}
      </div>
      <div role="status" className="sr-only">
        {status}
      </div>
      {data.watcherFailing && (
        <Bar
          tone="error"
          label={t('watcherTitle')}
          title={t('watcherTitle')}
          detail={t('watcherBody')}
          actions={
            <Button asChild size="sm" className={SOLID}>
              <Link href="/settings/watcher">{t('see')}</Link>
            </Button>
          }
        />
      )}
      {data.storageFailing && (
        <Bar
          tone="error"
          label={t('storageTitle')}
          title={t('storageTitle')}
          detail={t('storageBody')}
          actions={
            <Button asChild size="sm" className={SOLID}>
              <Link href="/settings/storage">{t('see')}</Link>
            </Button>
          }
        />
      )}
      {strip}
    </>
  )
}

function Bar({
  tone,
  label,
  title,
  detail,
  actions,
}: {
  tone: 'error' | 'ok'
  label: string
  title: string
  detail: string
  actions: ReactNode
}) {
  const Icon = tone === 'ok' ? CheckIcon : TriangleAlertIcon
  return (
    <section
      aria-label={label}
      data-strip={tone}
      className={cn(
        INK,
        'border-b border-black/15',
        tone === 'ok' ? 'bg-[#3DD68C]' : 'bg-[#FF6B3D]',
      )}
    >
      <div className="flex items-center gap-3 px-4 py-2 text-sm md:px-8">
        <Icon className="size-4 shrink-0" aria-hidden />
        <p className="flex min-w-0 flex-1 items-baseline gap-3">
          <span className="shrink-0 font-semibold">{title}</span>
          <span className="hidden min-w-0 truncate sm:block">{detail}</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </section>
  )
}

function Taker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md bg-black/10 px-2.5 text-xs font-medium',
        className,
      )}
    >
      <UserIcon className="size-3.5" aria-hidden />
      {children}
    </span>
  )
}

function TakeOne({ id, label }: { id: string; label: string }) {
  const { take, pending, error } = useTake()
  return (
    <>
      <Button size="sm" className={OUTLINE} disabled={pending} onClick={() => take([id])}>
        {label}
      </Button>
      {error && (
        <span role="alert" className="text-xs font-medium">
          {error}
        </span>
      )}
    </>
  )
}

/** "See all": every open emergency, ticked and taken at once. No grouping by itself. */
function SeeAll({ data, items, now }: { data: StripData; items: StripItem[]; now: number }) {
  const t = useTranslations('strip')
  const tl = useTranslations('strip.list')
  const locale = useLocale()
  const base = useId()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<StripFilter>('all')
  const [sort, setSort] = useState<StripSort>('nobody')
  const [expanded, setExpanded] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const { take, pending, error } = useTake()
  const since = (at: number) => duration(locale, now - at)

  const summary = stripSummary(items)
  const selected = picked.filter((id) => items.some((i) => i.id === id))
  const listed = sortItems(filterItems(items, filter, data.me), sort)
  const shown = expanded ? listed : listed.slice(0, LIST_FIRST)
  const shared = summary.shared
  const sharedItems = shared ? items.filter((i) => shared.ids.includes(i.id)) : []
  const seen = controlsSeen(sharedItems.length > 0 ? sharedItems : items)
  const list = (targets: string[]) =>
    targets.length < 2
      ? (targets[0] ?? '')
      : tl('and', { first: targets.slice(0, -1).join(', '), last: targets.at(-1) as string })
  const toggle = (id: string, on: boolean) =>
    setPicked((now) => (on ? [...now, id] : now.filter((x) => x !== id)))
  const title =
    summary.products < items.length
      ? t('countProducts', { count: items.length, products: summary.products })
      : t('count', { count: items.length })
  const sharedTogether = shared
    ? Math.round(
        (Math.max(...sharedItems.map((i) => i.startedAt)) -
          Math.min(...sharedItems.map((i) => i.startedAt))) /
          60_000,
      )
    : 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className={SOLID}>
          <span className="hidden sm:inline">{t('seeAll', { count: items.length })}</span>
          <span className="sm:hidden">{t('seeAllShort')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col gap-4 p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{tl('intro')}</DialogDescription>
        </DialogHeader>

        {shared && (
          <div className="flex gap-2.5 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <InfoIcon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            <div className="flex flex-col gap-1">
              <p className="font-medium">
                {sharedTogether <= 10
                  ? tl('hintTogether', {
                      count: shared.ids.length,
                      minutes: Math.max(1, sharedTogether),
                      ip: shared.ip,
                    })
                  : tl('hint', { count: shared.ids.length, ip: shared.ip })}
              </p>
              <p className="text-muted-foreground">
                {seen.reached.length > 0
                  ? `${tl('reached', { targets: list(seen.reached) })} `
                  : seen.failed.length > 0
                    ? `${tl('failed', { targets: list(seen.failed) })} `
                    : ''}
                {tl('decide')}
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={filter}
            onValueChange={(value) => value && setFilter(value as StripFilter)}
            aria-label={tl('filterLabel')}
          >
            <ToggleGroupItem className={ON} value="all">
              {tl('all', { count: items.length })}
            </ToggleGroupItem>
            <ToggleGroupItem className={ON} value="nobody">
              {tl('nobody', { count: filterItems(items, 'nobody', data.me).length })}
            </ToggleGroupItem>
            <ToggleGroupItem className={ON} value="mine">
              {tl('mine', { count: filterItems(items, 'mine', data.me).length })}
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="flex items-center gap-2 text-sm">
            <span id={`${base}-sort`} className="text-muted-foreground">
              {tl('sort')}
            </span>
            <Select value={sort} onValueChange={(value) => setSort(value as StripSort)}>
              <SelectTrigger size="sm" aria-labelledby={`${base}-sort`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nobody">{tl('sortNobody')}</SelectItem>
                <SelectItem value="oldest">{tl('sortOldest')}</SelectItem>
                <SelectItem value="newest">{tl('sortNewest')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="-mx-5 min-h-0 flex-1 overflow-y-auto border-y border-border sm:-mx-6">
          {shown.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">{tl('empty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((item) => {
                const Icon = KIND_ICON[item.kind]
                const kind = t(`kind.${item.kind}`)
                const checked = selected.includes(item.id)
                return (
                  <li
                    key={item.id}
                    className={cn(
                      'flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 sm:px-6',
                      checked && 'bg-primary/5',
                    )}
                  >
                    <Checkbox
                      id={`${base}-${item.id}`}
                      checked={checked}
                      onCheckedChange={(on) => toggle(item.id, on === true)}
                      aria-label={tl('select', { product: item.product, kind })}
                    />
                    <TriangleIcon className="size-3 shrink-0 fill-current text-error" aria-hidden />
                    <div className="flex min-w-48 flex-1 flex-col">
                      <span className="flex flex-wrap items-center gap-x-2 text-sm">
                        <span className="font-medium">{item.product}</span>
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Icon className="size-3" aria-hidden />
                          {kind}
                        </span>
                      </span>
                      <span className="truncate text-xs text-muted-foreground">{item.detail}</span>
                    </div>
                    {/* On a phone this group goes under the text. */}
                    <div className="ml-auto flex items-center gap-3">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {since(item.startedAt)}
                      </span>
                      {item.taker ? (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className="size-1.5 rounded-full bg-ok" aria-hidden />
                          {item.taker.id === data.me
                            ? tl('takerYou', { duration: since(item.taker.at) })
                            : tl('taker', {
                                name: item.taker.name,
                                duration: since(item.taker.at),
                              })}
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => take([item.id])}
                        >
                          {t('imOnIt')}
                        </Button>
                      )}
                      <Button asChild size="icon-sm" variant="ghost">
                        <Link
                          href={item.href}
                          aria-label={tl('open', { product: item.product, kind })}
                          onClick={() => setOpen(false)}
                        >
                          <ArrowRightIcon aria-hidden />
                        </Link>
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {!expanded && listed.length > LIST_FIRST && (
            <p className="px-5 py-2.5 text-xs text-muted-foreground sm:px-6">
              {tl('more', { count: listed.length - LIST_FIRST })} ·{' '}
              <Button
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() => setExpanded(true)}
              >
                {tl('showAll')}
              </Button>
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span aria-live="polite" className="font-medium">
            {tl('selected', { count: selected.length })}
          </span>
          {shared && (
            <Button variant="link" className="h-auto p-0" onClick={() => setPicked(shared.ids)}>
              {tl('selectShared', { count: shared.ids.length, ip: shared.ip })}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={() => setPicked([])} disabled={selected.length === 0}>
              {tl('clear')}
            </Button>
            <Button
              disabled={selected.length === 0 || pending}
              onClick={() => take(selected, () => setPicked([]))}
            >
              {selected.length > 0 ? tl('submit', { count: selected.length }) : tl('submitNone')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
