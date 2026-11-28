import type { ProductUptimeHistory } from '@octadash/db'
import { PlusIcon, ServerIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  type MonitorLine,
  type ProductLine,
  type StateCell,
  UptimeTable,
} from '@/components/uptime-table'
import { describeFailure } from '@/lib/monitors'
import {
  barState,
  CERT_WARN_DAYS,
  type MonitorState,
  STATE_ORDER,
  statusCodeOf,
  UPTIME_PERIODS,
  type UptimePeriodId,
  worstState,
} from '@/lib/uptime-board'
import { cn } from '@/lib/utils'
import { loadUptimeSetup } from '@/server/connection-setup'
import { type BoardMonitorData, loadUptimeBoard } from '@/server/uptime-board'
import { formatUptime } from '@/server/uptime-view'
import { AccountProducts, UptimeStartView } from './area-start-accounts'
import { duration } from './overview-parts'
/**
 * The Uptime board, as closed in the Uptime canvas (frame 3): every monitor of
 * every product, problems first. A group or a single product gets the same
 * page, filtered. States come from Postgres and stay right even when
 * ClickHouse, which holds the numbers and bars, does not answer.
 */
export async function UptimeBoardView({
  orgId,
  projectIds,
  base,
  periodId,
  title,
  manager,
  single,
}: {
  orgId: string
  projectIds: string[] | null
  /** "/all", "/g/<slug>" or "/p/<slug>": where the period links point. */
  base: string
  periodId: UptimePeriodId
  /** Shown after "Uptime" for a group: "Uptime · Main". */
  title?: string
  manager: boolean
  /** The page of one product: its monitors open from the start. */
  single?: { slug: string }
}) {
  const now = new Date()
  const [board, t, tu, locale] = await Promise.all([
    loadUptimeBoard(orgId, projectIds, periodId, now),
    getTranslations('uptimeBoard'),
    getTranslations('uptime'),
    getLocale(),
  ])
  const { period, timeZone } = board
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone })
  const number = new Intl.NumberFormat(locale)
  const seconds = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  })
  const ago = (at: Date) => {
    const ms = now.getTime() - at.getTime()
    return ms < 60_000 ? seconds.format(Math.max(1, Math.round(ms / 1000))) : duration(locale, ms)
  }
  const periodName = t(`periods.${period.id}`)

  const stateText = (state: MonitorState, kind: string, withCode: boolean): string => {
    switch (state.state) {
      case 'paused':
        return t('state.paused')
      case 'waiting':
        return kind === 'heartbeat' ? t('state.waitingCall') : t('state.waiting')
      case 'late':
        return t('state.late', { time: time.format(state.due) })
      case 'slow':
        return t('state.slow', { time: seconds.format(state.medianMs / 1000) })
      case 'up':
        return state.lastCall ? t('state.called', { time: ago(state.lastCall) }) : t('state.up')
      case 'down': {
        const since = state.since ? ` ${ago(state.since)}` : ''
        if (!withCode || !state.reason) return t('state.down', { time: since.trim() })
        const reason =
          statusCodeOf(state.reason) ??
          describeFailure(state.reason, (key, values) => tu(`failure.${key}`, values))
        return t('state.downWhy', { time: since.trim(), reason })
      }
    }
  }
  const cell = (state: MonitorState, kind: string, withCode: boolean): StateCell => ({
    name: state.state,
    text: stateText(state, kind, withCode),
  })
  const bars = (history: ProductUptimeHistory | null) => {
    const buckets = history?.buckets ?? []
    const states = buckets.map(barState)
    const bad = states.filter((s) => s === 'down' || s === 'partial').length
    return {
      bars: states,
      barsText:
        buckets.length === 0
          ? t('bars.none')
          : t(period.bucket === 'hour' ? 'bars.hours' : 'bars.days', {
              bad,
              count: buckets.length,
            }),
    }
  }
  const ms = (value: number | null) => (value === null ? '–' : `${number.format(value)} ms`)
  const certText = (days: number | null) => (days === null ? '–' : tu('certDays', { count: days }))
  const kindLabel = {
    site: t('kind.site'),
    health: t('kind.health'),
    heartbeat: t('kind.heartbeat'),
  }

  const sortByState = (a: { state: MonitorState }, b: { state: MonitorState }) =>
    STATE_ORDER[a.state.state] - STATE_ORDER[b.state.state]

  const products: ProductLine[] = board.products
    .map((p) => {
      const monitors = [...p.monitors].sort(sortByState)
      const worst = worstState(monitors) as BoardMonitorData
      const active = p.monitors.filter((m) => !m.monitor.paused)
      let checks = 0
      let ups = 0
      let medianMs: number | null = null
      let certDays: number | null = null
      for (const m of active) {
        const s = m.stats
        if (!s) continue
        checks += s.checks
        ups += (s.uptime ?? 0) * s.checks
        if (s.medianMs !== null) medianMs = Math.max(medianMs ?? 0, s.medianMs)
        if (s.certDays !== null)
          certDays = Math.min(certDays ?? Number.POSITIVE_INFINITY, s.certDays)
      }
      const lines: MonitorLine[] = monitors.map((m) => ({
        id: m.monitor.id,
        name: m.monitor.name,
        kind: monitorDetail(m.monitor.name, kindLabel[m.monitor.kind], m.monitor.url),
        paused: m.monitor.paused,
        editHref: manager ? `/p/${p.project.slug}/uptime/${m.monitor.id}/edit` : null,
        state: cell(m.state, m.monitor.kind, true),
        ...bars(m.history),
        uptime: formatUptime(m.stats?.uptime ?? null, locale),
        response:
          m.monitor.kind === 'heartbeat' || m.state.state === 'down'
            ? '–'
            : ms(m.stats?.medianMs ?? null),
        cert: m.monitor.kind === 'heartbeat' ? '' : certText(m.stats?.certDays ?? null),
        certWarn: (m.stats?.certDays ?? Number.POSITIVE_INFINITY) <= CERT_WARN_DAYS,
      }))
      return {
        order: STATE_ORDER[worst.state.state],
        line: {
          id: p.project.id,
          name: p.project.name,
          count: tu('monitors', { count: p.monitors.length }),
          href: `/p/${p.project.slug}/uptime`,
          addHref: manager ? `/p/${p.project.slug}/uptime/new` : null,
          monitors: lines,
          state: cell(worst.state, worst.monitor.kind, false),
          ...bars(p.history),
          uptime: formatUptime(checks > 0 ? ups / checks : null, locale),
          response: worst.state.state === 'down' ? '–' : ms(medianMs),
          cert: certText(certDays),
          certWarn: certDays !== null && certDays <= CERT_WARN_DAYS,
        } satisfies ProductLine,
      }
    })
    .sort((a, b) => a.order - b.order || a.line.name.localeCompare(b.line.name, locale))
    .map((row) => row.line)

  // Tiles.
  const all = board.products.flatMap((p) => p.monitors.map((m) => ({ ...m, product: p.project })))
  const active = all.filter((m) => !m.monitor.paused)
  const down = active.filter((m) => m.state.state === 'down')
  const downProducts = new Set(down.map((m) => m.product.id)).size
  const ratio = board.totals.checks > 0 ? board.totals.ups / board.totals.checks : null
  const change =
    board.totals.medianMs !== null && board.previous.medianMs
      ? Math.round(
          ((board.totals.medianMs - board.previous.medianMs) / board.previous.medianMs) * 100,
        )
      : null
  const expiring = active
    .filter((m) => m.stats?.certDays != null && m.stats.certDays <= CERT_WARN_DAYS)
    .sort((a, b) => (a.stats?.certDays ?? 0) - (b.stats?.certDays ?? 0))
  const firstExpiring = expiring[0]
  const sameServer = all.filter((m) => m.sameServer)
  const names = new Intl.ListFormat(locale, { type: 'conjunction' })

  const addAction =
    manager &&
    board.products.length + board.without.length > 0 &&
    (single ? (
      <Button asChild>
        <Link href={`/p/${single.slug}/uptime/new`}>
          <PlusIcon data-icon="inline-start" />
          {tu('add')}
        </Link>
      </Button>
    ) : (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>
            <PlusIcon data-icon="inline-start" />
            {tu('add')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {[...board.products.map((p) => p.project), ...board.without]
            .sort((a, b) => a.name.localeCompare(b.name, locale))
            .map((project) => (
              <DropdownMenuItem key={project.id} asChild>
                <Link href={`/p/${project.slug}/uptime/new`}>{project.name}</Link>
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ))

  const heading = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex max-w-2xl flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">
          {title ? `${tu('title')} · ${title}` : tu('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      {addAction}
    </div>
  )

  if (board.products.length === 0) {
    const setup = await loadUptimeSetup(orgId, board.without)
    const [first] = setup
    if (single && first) return <UptimeStartView product={first.product} setup={first} />
    return (
      <>
        {heading}
        <AccountProducts area="uptime" setup={setup} folded={false} />
      </>
    )
  }

  return (
    <>
      {heading}

      {!board.complete && (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          {t('incomplete')}
        </p>
      )}

      <section
        aria-label={t('totals')}
        className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,13rem),1fr))]"
      >
        <Tile
          label={t('tiles.upNow')}
          value={t('tiles.upNowValue', { up: active.length - down.length, total: active.length })}
          sub={
            down.length > 0
              ? t('tiles.downOn', { count: down.length, products: downProducts })
              : t('tiles.allUp')
          }
          alert={down.length > 0}
        />
        <Tile
          label={t('tiles.uptime', { period: periodName })}
          value={formatUptime(ratio, locale)}
          sub={t('tiles.weighted')}
        />
        <Tile
          label={t('tiles.response')}
          value={ms(board.totals.medianMs)}
          sub={
            change === null
              ? t('tiles.noPrevious')
              : t('tiles.vsPrevious', {
                  change: `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}`,
                  period: periodName,
                })
          }
        />
        <Tile
          label={t('tiles.certificates')}
          value={
            expiring.length > 0
              ? t('tiles.expiring', { count: expiring.length })
              : t('tiles.noneExpiring')
          }
          sub={
            firstExpiring
              ? t('tiles.firstExpiring', {
                  product: firstExpiring.product.name,
                  days: tu('certDays', { count: firstExpiring.stats?.certDays ?? 0 }),
                })
              : t('tiles.noneWithin', { days: CERT_WARN_DAYS })
          }
          warn={expiring.length > 0}
        />
      </section>

      {board.sameIp.map((group) => {
        const products = [...new Set(group.incidents.map((i) => i.project_name))]
        return (
          <section
            key={`${group.ip}-${group.incidents[0]?.id}`}
            aria-label={t('sameIp.label')}
            className="flex gap-3 rounded-xl border border-error/40 bg-error/10 p-4 text-sm"
          >
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-error" aria-hidden />
            <div className="flex flex-col gap-1">
              <p className="font-medium">
                {t('sameIp.title', {
                  products: names.format(products),
                  minutes: group.apartMinutes,
                })}
              </p>
              <p className="text-muted-foreground">
                {t('sameIp.body', { ip: group.ip, count: products.length })}
              </p>
              <p className="flex flex-wrap gap-x-3">
                {group.incidents.map((incident) => (
                  <Link
                    key={incident.id}
                    href={`/p/${incident.project_slug}/emergencies/${incident.id}`}
                    className="text-brand underline underline-offset-2"
                  >
                    {t('sameIp.see', { product: incident.project_name })}
                  </Link>
                ))}
              </p>
            </div>
          </section>
        )
      })}

      {sameServer.length > 0 && (
        <section
          aria-label={tu('sameServerTitle')}
          className="flex gap-3 rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm"
        >
          <ServerIcon className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="font-medium">
              {t('sameServer', {
                count: sameServer.length,
                monitors: names.format(
                  sameServer.map((m) =>
                    single ? m.monitor.name : `${m.product.name} · ${m.monitor.name}`,
                  ),
                ),
              })}
            </p>
            <p className="text-muted-foreground">{tu('sameServerBody')}</p>
          </div>
        </section>
      )}

      <UptimeTable
        products={products}
        open={!!single}
        periods={UPTIME_PERIODS.map((id) => ({
          id,
          label: t(`periodShort.${id}`),
          href: `${base}/uptime${id === '45d' ? '' : `?period=${id}`}`,
          current: id === period.id,
        }))}
        labels={{
          filters: t('filters'),
          all: t('filter.all'),
          down: t('filter.down'),
          lateOrSlow: t('filter.lateOrSlow'),
          paused: t('filter.paused'),
          search: t('search'),
          periods: t('periodsLabel'),
          product: t('product'),
          now: t('now'),
          bars: t('last', { period: periodName }),
          uptime: t('uptimeColumn'),
          response: tu('response'),
          certificate: tu('certificate'),
          actions: t('actions'),
          expand: t('expand'),
          collapse: t('collapse'),
          open: t('open'),
          add: tu('add'),
          edit: tu('edit'),
          pause: tu('pause'),
          resume: tu('resume'),
          more: t('more'),
          show: t('show'),
          without: board.without.length > 0 ? t('without', { count: board.without.length }) : '',
          nothing: t('nothing'),
        }}
      />
    </>
  )
}

function Tile({
  label,
  value,
  sub,
  alert,
  warn,
}: {
  label: string
  value: string
  sub: string
  alert?: boolean
  warn?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-xl border bg-card p-4',
        alert ? 'border-error/60' : 'border-border',
      )}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          'font-display text-2xl font-semibold tabular-nums',
          alert && 'text-error',
          warn && 'text-warn',
        )}
      >
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  )
}

/**
 * What follows a monitor's name in the table: its kind, unless the name already
 * says it ("Site · Site"), and the host it checks, so two monitors of one
 * product never look the same.
 */
function monitorDetail(name: string, kind: string, url: string | null): string {
  const parts = name.trim().toLowerCase() === kind.toLowerCase() ? [] : [kind]
  if (url) {
    try {
      parts.push(new URL(url).host)
    } catch {
      // A stored address is always valid; nothing to add if it is not.
    }
  }
  return parts.join(' · ')
}
