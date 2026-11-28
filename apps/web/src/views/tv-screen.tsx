'use client'

import type { TvSlot } from '@octadash/db'
import {
  CircleDashedIcon,
  CircleIcon,
  DiamondIcon,
  TriangleAlertIcon,
  UserIcon,
  Volume2Icon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { duration } from '@/lib/duration'
import { TV_PAGE_MS, type TvMetric, type TvSettings, tvPages } from '@/lib/tv'
import { cn } from '@/lib/utils'
import type { TvData, TvTile } from '@/server/tv'

/** Numbers that do not raise an event (visitors) are fetched again this often. */
const REFRESH_MS = 30_000
const BURST_MS = 500

/** A short two-tone sound for a new emergency, made in the browser: no file to load. */
function beep(context: AudioContext) {
  for (const [i, freq] of [880, 660].entries()) {
    const osc = context.createOscillator()
    const gain = context.createGain()
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.2, context.currentTime + i * 0.25)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + i * 0.25 + 0.22)
    osc.connect(gain).connect(context.destination)
    osc.start(context.currentTime + i * 0.25)
    osc.stop(context.currentTime + i * 0.25 + 0.25)
  }
}

function useClock(serverNow: number) {
  const offset = useRef(serverNow - Date.now())
  useEffect(() => {
    offset.current = serverNow - Date.now()
  }, [serverNow])
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset.current), 5000)
    return () => clearInterval(id)
  }, [])
  return Math.max(now, serverNow)
}

/** Live: reloads on any change of incidents or monitors, and every 30 s for visitors. */
function useLive(liveUrl: string) {
  const router = useRouter()
  useEffect(() => {
    if (!liveUrl) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => router.refresh(), BURST_MS)
    }
    const every = setInterval(() => router.refresh(), REFRESH_MS)
    let source: EventSource | undefined
    if (typeof EventSource !== 'undefined') {
      source = new EventSource(liveUrl)
      for (const topic of ['incidents', 'monitors']) source.addEventListener(topic, refresh)
    }
    return () => {
      clearTimeout(timer)
      clearInterval(every)
      source?.close()
    }
  }, [liveUrl, router])
}

function Sparkline({ values, alarm }: { values: number[]; alarm: boolean }) {
  const max = Math.max(...values, 1)
  const points = values
    .map((v, i) => `${(i / Math.max(values.length - 1, 1)) * 100},${28 - (v / max) * 24}`)
    .join(' ')
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className="mt-auto h-8 w-full overflow-visible"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        className={alarm ? 'stroke-error' : 'stroke-brand'}
      />
    </svg>
  )
}

function Checks({ checks, label }: { checks: TvSlot[] | null; label: string }) {
  if (!checks) return <div className="h-5" />
  return (
    <div role="img" aria-label={label} className="flex h-5 gap-[2px]">
      {checks.map((c, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: one slot per 5 minutes, fixed order
          key={i}
          className={cn(
            'flex-1 rounded-[1px]',
            c === 'up' ? 'bg-ok' : c === 'down' ? 'bg-error' : 'bg-muted',
          )}
        />
      ))}
    </div>
  )
}

export function TvScreen({
  data,
  settings,
  liveUrl,
  stopped,
}: {
  data: TvData | null
  settings: TvSettings
  liveUrl: string
  /** The private link was stopped: the TV goes blank. */
  stopped?: boolean
}) {
  const t = useTranslations('tv')
  const format = useFormatter()
  const locale = useLocale()
  useLive(liveUrl)
  const now = useClock(data?.serverNow ?? Date.now())
  const [page, setPage] = useState(0)
  const pages = useMemo(
    () => (data ? tvPages(data.tiles, settings.perPage) : [[]]),
    [data, settings.perPage],
  )
  useEffect(() => {
    if (pages.length < 2) return
    const id = setInterval(() => setPage((p) => (p + 1) % pages.length), TV_PAGE_MS)
    return () => clearInterval(id)
  }, [pages.length])
  const current = pages[page % pages.length] ?? []

  // Sound: the browser needs one click before it plays anything.
  const audio = useRef<AudioContext | null>(null)
  const [soundOn, setSoundOn] = useState(false)
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!data) return
    const ids = new Set(data.emergencies.map((e) => e.id))
    const before = seen.current
    seen.current = ids
    if (!before || !soundOn || !audio.current) return
    if ([...ids].some((id) => !before.has(id))) beep(audio.current)
  }, [data, soundOn])

  if (stopped || !data) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-8 text-center">
        <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
        <p className="max-w-lg text-xl text-muted-foreground">
          {stopped ? t('stopped') : t('missing')}
        </p>
      </main>
    )
  }

  const clock = format.dateTime(now, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: data.timeZone,
  })
  const isDown = (tile: TvTile) => Boolean(tile.emergency) || tile.status === 'down'
  const down = data.tiles.filter(isDown).length
  const signals = data.tiles.filter((tile) => !isDown(tile) && tile.signal).length
  const up = data.tiles.filter(
    (tile) => !isDown(tile) && !tile.signal && tile.status === 'up',
  ).length
  const value = (metric: TvMetric, v: number | null | undefined) =>
    v === null || v === undefined
      ? '—'
      : metric === 'responseMs'
        ? t('ms', { value: v })
        : format.number(v)
  const em = data.emergencies

  return (
    <main className="flex min-h-dvh flex-col bg-background text-lg text-foreground">
      <div aria-live="assertive" className="sr-only">
        {em.length > 0
          ? t('strip.title', { count: em.length, names: em.map((e) => e.product).join(', ') })
          : ''}
      </div>
      {em.length > 0 && (
        <section
          aria-label={t('strip.label')}
          className="flex flex-wrap items-center gap-x-6 gap-y-3 bg-[#FF6B3D] px-8 py-5 text-[#1a0d06]"
        >
          <TriangleAlertIcon aria-hidden className="size-9 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="font-display text-3xl font-semibold">
              {em.length === 1
                ? em[0]?.title
                : t('strip.title', {
                    count: em.length,
                    names: format.list(
                      em.slice(0, 3).map((e) => e.product),
                      { type: 'conjunction' },
                    ),
                  })}
            </p>
            <p className="text-lg">
              {em
                .slice(0, 3)
                .map((e) => `${e.product}: ${e.detail} · ${duration(locale, now - e.startedAt)}`)
                .join(' · ')}
            </p>
          </div>
          <ul className="flex flex-wrap gap-2">
            {em.slice(0, 4).map((e) => (
              <li
                key={e.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-1.5 text-base font-semibold',
                  e.taker ? 'bg-[#1a0d06]/15' : 'border-2 border-[#1a0d06]',
                )}
              >
                {e.taker ? (
                  <>
                    <UserIcon aria-hidden className="size-4" />
                    {t('strip.taker', {
                      name: e.taker.name,
                      product: e.product,
                      time: duration(locale, now - e.taker.at),
                    })}
                  </>
                ) : (
                  t('strip.nobody', { product: e.product })
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 px-8 pt-6 pb-4">
        <h1 className="font-display text-3xl font-semibold">{data.title ?? t('all')}</h1>
        <p className="flex flex-wrap items-center gap-4 text-xl font-semibold">
          {down > 0 && (
            <span className="flex items-center gap-1.5 text-error">
              <TriangleAlertIcon aria-hidden className="size-5" />
              {t('down', { count: down })}
            </span>
          )}
          {up > 0 && (
            <span className="flex items-center gap-1.5 text-ok">
              <CircleIcon aria-hidden className="size-3.5 fill-current" />
              {down === 0 && signals === 0 && up === data.tiles.length
                ? t('allUp', { count: up })
                : t('up', { count: up })}
            </span>
          )}
          {signals > 0 && (
            <span className="flex items-center gap-1.5 text-warn">
              <DiamondIcon aria-hidden className="size-4 fill-current" />
              {t('signals', { count: signals })}
            </span>
          )}
        </p>
        <div className="ml-auto flex items-center gap-6">
          {settings.sound && !soundOn && (
            <button
              type="button"
              onClick={() => {
                audio.current = new AudioContext()
                setSoundOn(true)
              }}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-base text-muted-foreground hover:text-foreground"
            >
              <Volume2Icon aria-hidden className="size-5" />
              {t('allowSound')}
            </button>
          )}
          <span className="flex items-center gap-2 text-muted-foreground">
            <CircleIcon aria-hidden className="size-3 fill-current" />
            {t('online', { count: data.online })}
          </span>
          <time className="font-display text-4xl font-semibold tabular-nums">{clock}</time>
        </div>
      </header>

      {data.tiles.length === 0 ? (
        <p className="px-8 text-xl text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul
          className={cn(
            'grid flex-1 auto-rows-fr gap-4 px-8 pb-4',
            settings.perPage === 6
              ? 'grid-cols-1 md:grid-cols-3'
              : settings.perPage === 12
                ? 'grid-cols-1 md:grid-cols-4'
                : 'grid-cols-1 md:grid-cols-3',
          )}
        >
          {current.map((tile) => (
            <Tile key={tile.id} tile={tile} metrics={settings.metrics} now={now} value={value} />
          ))}
        </ul>
      )}

      <footer className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border px-8 py-3 text-base">
        <h2 className="font-semibold">{t('happened')}</h2>
        {data.happened.length === 0 ? (
          <span className="text-muted-foreground">{t('nothingHappened')}</span>
        ) : (
          <ol className="flex min-w-0 flex-1 flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
            {data.happened.slice(0, 4).map((h) => (
              <li key={`${h.kind}-${h.incident}-${h.at}`}>
                <span className="text-foreground tabular-nums">
                  {format.dateTime(h.at, {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: data.timeZone,
                  })}
                </span>{' '}
                {t(`event.${h.kind}`, {
                  product: h.product,
                  person: h.person ?? '',
                  name: h.name ?? '',
                })}
              </li>
            ))}
          </ol>
        )}
        <span className="ml-auto text-muted-foreground">
          {t('page', { page: (page % pages.length) + 1, pages: pages.length })}
          {data.complete ? '' : ` · ${t('incomplete')}`}
        </span>
      </footer>
    </main>
  )
}

function Tile({
  tile,
  metrics,
  now,
  value,
}: {
  tile: TvTile
  metrics: TvMetric[]
  now: number
  value: (metric: TvMetric, v: number | null | undefined) => string
}) {
  const t = useTranslations('tv')
  const locale = useLocale()
  const e = tile.emergency
  const checks = tile.activity?.checks ?? null
  const downs = checks?.filter((c) => c === 'down').length ?? 0
  const ups = checks?.filter((c) => c === 'up').length ?? 0
  const status = e
    ? { icon: TriangleAlertIcon, word: t('state.down'), className: 'text-error' }
    : tile.signal
      ? { icon: DiamondIcon, word: t('state.signal'), className: 'text-warn' }
      : tile.status === 'up'
        ? { icon: CircleIcon, word: t('state.up'), className: 'text-ok' }
        : tile.status === 'down'
          ? { icon: TriangleAlertIcon, word: t('state.down'), className: 'text-error' }
          : tile.status === 'unknown'
            ? { icon: CircleDashedIcon, word: t('state.waiting'), className: 'text-warn' }
            : { icon: CircleDashedIcon, word: t('state.none'), className: 'text-muted-foreground' }
  const Icon = status.icon
  const first = metrics[0]
  const numbers: { label: string; value: string; alarm?: boolean; text?: boolean }[] = e
    ? [
        { label: t('downFor'), value: duration(locale, now - e.startedAt), alarm: true },
        { label: t('lastCheck'), value: e.detail.split(': ').at(-1) ?? '', text: true },
        ...(first
          ? [{ label: t(`metric.${first}`), value: value(first, tile.values[first]) }]
          : []),
      ]
    : metrics.map((m) => ({ label: t(`metric.${m}`), value: value(m, tile.values[m]) }))

  return (
    <li
      className={cn(
        'flex min-h-0 flex-col gap-3 rounded-2xl border bg-card p-5',
        e
          ? 'border-2 border-error bg-error/10'
          : tile.signal
            ? 'border-2 border-warn'
            : 'border-border',
      )}
    >
      <div className="flex items-start gap-3">
        <h2 className="min-w-0 flex-1 truncate font-display text-2xl font-semibold">{tile.name}</h2>
        <span className={cn('flex items-center gap-1.5 text-lg font-semibold', status.className)}>
          <Icon aria-hidden className={cn('size-4', !e && !tile.signal && 'fill-current')} />
          {status.word}
        </span>
      </div>
      {e && (
        <p className="-mt-2 text-base text-muted-foreground">
          {e.taker
            ? t('onIt', { name: e.taker.name, time: duration(locale, now - e.taker.at) })
            : t('nobodyOnIt')}
        </p>
      )}
      {!e && tile.signal && (
        <p className="-mt-2 text-base text-muted-foreground">{tile.signal.detail}</p>
      )}
      <Checks checks={checks} label={t('checksLabel', { ups, downs })} />
      <dl className="grid grid-cols-3 gap-3">
        {numbers.map((n) => (
          <div key={n.label} className="flex min-w-0 flex-col">
            <dt className="truncate text-sm font-medium tracking-wide text-muted-foreground uppercase">
              {n.label}
            </dt>
            <dd
              className={cn(
                'font-display leading-tight font-semibold tabular-nums',
                n.text ? 'line-clamp-2 text-2xl' : 'truncate text-[34px]',
                n.alarm && 'text-error',
              )}
            >
              {n.value}
            </dd>
          </div>
        ))}
      </dl>
      {tile.activity && <Sparkline values={tile.activity.spark} alarm={Boolean(e)} />}
    </li>
  )
}
