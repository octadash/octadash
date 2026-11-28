import {
  CheckIcon,
  CircleDotIcon,
  CircleIcon,
  DiamondIcon,
  SearchIcon,
  SparklesIcon,
  TriangleIcon,
} from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { AddSourceAction } from '@/components/add-source-action'
import { FunnelDialog } from '@/components/funnel-dialog'
import { InfoTip } from '@/components/info-tip'
import { MetricChart } from '@/components/metric-chart'
import { SourceFilter } from '@/components/source-filter'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { percentChange } from '@/lib/period'
import {
  EVENTS_PAGE,
  type NormalStatus,
  USAGE_PERIODS,
  type UsageMetric,
  type UsageState,
  usageHref,
} from '@/lib/usage'
import { cn } from '@/lib/utils'
import { loadAreaSetup } from '@/server/area-setup'
import { type FunnelResult, loadUsage, type UsageEvent } from '@/server/usage'
import { AreaProducts, AreaProductsPage } from './area-start'
import { UsageStartView } from './area-start-views'

/** "Normal?": a shape and the words, never the color alone. */
const NORMAL_ICON: Record<NormalStatus, { icon: typeof CircleIcon; className: string }> = {
  expected: { icon: CircleDotIcon, className: 'text-ok' },
  below: { icon: DiamondIcon, className: 'text-warn' },
  above: { icon: DiamondIcon, className: 'text-warn' },
  new: { icon: SparklesIcon, className: 'text-brand' },
  few: { icon: CircleIcon, className: 'text-muted-foreground' },
  stopped: { icon: TriangleIcon, className: 'fill-current text-error' },
}

/**
 * Product usage, as closed in the Product usage canvas: numbers on top that
 * switch the chart, the events with what is normal for each, then funnels and
 * who comes back. Every product (`projectIds` null), a group or one product.
 */
export async function UsageView({
  orgId,
  projectIds,
  path,
  state,
  group,
  product,
}: {
  orgId: string
  projectIds: string[] | null
  /** "/all/usage", "/g/<slug>/usage", "/p/<slug>/usage". */
  path: string
  state: UsageState
  group?: string
  product?: { name: string; slug: string }
}) {
  const [data, t, format, locale] = await Promise.all([
    loadUsage(orgId, projectIds, state),
    getTranslations('usageArea'),
    getFormatter(),
    getLocale(),
  ])
  const number = new Intl.NumberFormat(locale)
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
  const now = new Date()
  const several = data.projects.length > 1

  const setup = await loadAreaSetup(orgId, data.projects, 'usage')
  if (!data.anyEvent && !setup.some((s) => s.state === 'sending')) {
    const [first] = setup
    if (product && first) return <UsageStartView orgId={orgId} product={product} setup={first} />
    return (
      <AreaProductsPage title={t('title')} intro={group ? t('introGroup', { group }) : t('intro')}>
        <AreaProducts area="usage" setup={setup} folded={false} />
      </AreaProductsPage>
    )
  }

  const delta = (current: number, before: number) => {
    const c = percentChange(current, before)
    return c === null || c === 0
      ? null
      : { text: `${c > 0 ? '↑' : '↓'} ${Math.abs(c)}%`, up: c > 0, c }
  }
  const share = (b: { people: number; returned: number }) =>
    b.people > 0 ? b.returned / b.people : null
  const backNow = share(data.totals.cameBack)
  const backBefore = share(data.previous.cameBack)
  const points =
    backNow !== null && backBefore !== null ? Math.round((backNow - backBefore) * 100) : null

  const tiles: {
    id: UsageMetric | 'cameBack'
    value: string
    delta: { text: string; up: boolean; c: number } | null
    note?: string
  }[] = [
    {
      id: 'active',
      value: number.format(data.totals.active),
      delta: delta(data.totals.active, data.previous.active),
    },
    {
      id: 'signups',
      value: number.format(data.totals.signups),
      delta: delta(data.totals.signups, data.previous.signups),
    },
    {
      id: 'keyEvents',
      value: number.format(data.totals.keyEvents),
      delta: delta(data.totals.keyEvents, data.previous.keyEvents),
      note:
        data.totals.keyEvents === 0 && data.previous.keyEvents === 0
          ? t('tiles.noKeys')
          : undefined,
    },
    {
      id: 'cameBack',
      value: backNow === null ? '–' : percent.format(backNow),
      delta:
        points === null || points === 0
          ? null
          : {
              text: `${points > 0 ? '↑' : '↓'} ${Math.abs(points)} ${t('pts')}`,
              up: points > 0,
              c: points,
            },
      note:
        backNow === null
          ? t('tiles.cameBackNone')
          : t('tiles.cameBackOf', { count: data.totals.cameBack.people }),
    },
  ]

  const offset = data.previousSeries.length - data.series.length
  const chartPoints = data.series.map((p, i) => ({
    at: p.at.toISOString(),
    current: p[state.metric],
    previous: data.previousSeries[i + offset]?.[state.metric] ?? null,
  }))

  const intro = product
    ? t('introOne', { product: product.name })
    : group
      ? t('introGroup', { group })
      : t('intro')

  const normalText = (e: UsageEvent) => {
    switch (e.normal.status) {
      case 'below':
        return t('normal.below', { percent: e.normal.percent })
      case 'above':
        return t('normal.above', { percent: e.normal.percent })
      case 'stopped':
        return e.last
          ? t('normal.stoppedSince', { ago: format.relativeTime(e.last, now) })
          : t('normal.stopped')
      default:
        return t(`normal.${e.normal.status}`)
    }
  }
  const vsBefore = (e: UsageEvent) => {
    const c = percentChange(e.count, e.before)
    if (c === null) return e.count > 0 ? t('table.newNow') : '–'
    return `${c > 0 ? '+' : ''}${c}%`
  }
  const products = data.projects.map((p) => ({ slug: p.slug, name: p.name }))
  const suggestions = data.events.filter((e) => e.count > 0).map((e) => e.event)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{intro}</p>
          {several && (
            <p className="text-sm text-muted-foreground">
              {t('sending', { count: data.projects.length, sending: data.sending })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {product && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/p/${product.slug}/usage/setup`}>{t('setUp')}</Link>
            </Button>
          )}
          <nav aria-label={t('periodLabel')} className="flex rounded-lg border border-border p-0.5">
            {USAGE_PERIODS.map((id) => (
              <Link
                key={id}
                href={usageHref(path, state, { period: id })}
                aria-current={id === state.period ? 'true' : undefined}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground',
                  id === state.period && 'bg-secondary font-medium text-foreground',
                )}
              >
                {t(`periods.${id}`)}
              </Link>
            ))}
          </nav>
          <SourceFilter
            label={t('source')}
            all={t('allSources')}
            allHref={usageHref(path, state, { source: null })}
            current={data.source?.id ?? null}
            options={data.sources.map((s) => ({
              ...s,
              href: usageHref(path, state, { source: s.id }),
            }))}
          />
          <AddSourceAction
            area="usage"
            products={data.projects.map((p) => ({ slug: p.slug, name: p.name }))}
            label={t('addSource')}
            pick={t('addSourceTo')}
          />
        </div>
      </div>

      {!data.complete && (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          {t('incomplete')}
        </p>
      )}

      {data.signals.length > 0 && (
        <section
          aria-label={t('signals.label')}
          className="flex flex-col gap-1 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm"
        >
          {data.signals.map((s) => (
            <p key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <DiamondIcon className="size-3 shrink-0 fill-current text-warn" aria-hidden />
              <span>
                {t('signals.signupsDropped', {
                  product: s.product,
                  count: s.count,
                  expected: s.expected,
                  percent: s.percent,
                })}
              </span>
              <Link href={s.href} className="text-brand underline underline-offset-2">
                {t('signals.see')}
              </Link>
            </p>
          ))}
        </section>
      )}

      <section
        aria-label={t('tiles.label')}
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      >
        {tiles.map((tile) => {
          const body = (
            <>
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                {t(`tiles.${tile.id}`)}
                {tile.id === 'cameBack' && (
                  <InfoTip label={t('tiles.cameBackInfoLabel')} title={t('tiles.cameBack')}>
                    {t('tiles.cameBackInfo')}
                  </InfoTip>
                )}
              </span>
              <span className="flex items-baseline gap-2">
                <span className="font-display text-2xl font-semibold tabular-nums">
                  {tile.value}
                </span>
                {tile.delta && (
                  <span
                    className={cn('text-sm tabular-nums', tile.delta.up ? 'text-ok' : 'text-error')}
                  >
                    {tile.delta.text}
                    <span className="sr-only">
                      {' '}
                      {tile.id === 'cameBack'
                        ? t('changePoints', { change: tile.delta.c })
                        : t('change', { change: tile.delta.c })}
                    </span>
                  </span>
                )}
              </span>
              {tile.note && <span className="text-xs text-muted-foreground">{tile.note}</span>}
            </>
          )
          return tile.id === 'cameBack' ? (
            <div
              key={tile.id}
              className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4"
            >
              {body}
            </div>
          ) : (
            <Link
              key={tile.id}
              href={usageHref(path, state, { metric: tile.id })}
              aria-current={tile.id === state.metric ? 'true' : undefined}
              className={cn(
                'flex flex-col gap-1 rounded-xl border bg-card p-4 hover:border-brand focus-visible:border-brand',
                tile.id === state.metric ? 'border-brand ring-1 ring-brand' : 'border-border',
              )}
            >
              {body}
            </Link>
          )
        })}
      </section>

      <MetricChart
        metrics={[
          {
            id: state.metric,
            label: t(`tiles.${state.metric}`),
            unit: 'count',
            points: chartPoints,
          },
        ]}
        marks={[]}
        labels={{
          current: t('chart.current'),
          previous: t('chart.previous'),
          emergency: t('chart.emergency'),
          asTable: t('chart.asTable'),
          time: t('chart.time'),
        }}
        locale={locale}
        timeZone={data.timeZone}
        bucket={data.period.bucket}
        span={state.period === 'today' ? '24h' : state.period}
      />

      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b py-4">
          <CardTitle>
            <h2 className="flex items-center gap-1 text-base font-semibold">
              {t('events')}
              <InfoTip label={t('eventsInfoLabel')} title={t('events')}>
                {t('eventsInfo')}
              </InfoTip>
            </h2>
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <form action={path} className="relative">
              {state.period !== '7d' && <input type="hidden" name="period" value={state.period} />}
              {state.metric !== 'active' && (
                <input type="hidden" name="metric" value={state.metric} />
              )}
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                name="q"
                defaultValue={state.q}
                placeholder={t('search')}
                aria-label={t('searchLabel')}
                className="w-56 pl-8 font-mono"
              />
            </form>
            <FunnelDialog products={products} events={suggestions} />
          </div>
        </CardHeader>
        {data.events.length === 0 ? (
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">
              {state.q ? t('noMatch', { q: state.q }) : t('noEvents')}
            </p>
          </CardContent>
        ) : (
          <Table scrollLabel={t('events')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('table.event')}</TableHead>
                {several && <TableHead>{t('table.product')}</TableHead>}
                <TableHead>{t('source')}</TableHead>
                <TableHead className="text-right">{t(`table.count.${state.period}`)}</TableHead>
                <TableHead className="text-right">{t('table.vsBefore')}</TableHead>
                <TableHead className="text-right">{t('table.people')}</TableHead>
                <TableHead>{t('table.normal')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.events.map((e) => {
                const { icon: Icon, className } = NORMAL_ICON[e.normal.status]
                return (
                  <TableRow key={`${e.projectId}:${e.event}`}>
                    <TableCell className="font-mono text-sm font-medium">
                      <span className="flex items-center gap-1.5">
                        {e.event}
                        {e.key && (
                          <>
                            <CheckIcon aria-hidden className="size-3.5 text-brand" />
                            <span className="sr-only">{t('table.key')}</span>
                          </>
                        )}
                      </span>
                    </TableCell>
                    {several && (
                      <TableCell>
                        <Link
                          href={`/p/${e.product.slug}/usage`}
                          className="text-sm hover:underline"
                        >
                          {e.product.name}
                        </Link>
                      </TableCell>
                    )}
                    <TableCell className="text-sm text-muted-foreground">
                      {e.sourceNames.join(', ') || '–'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {number.format(e.count)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {vsBefore(e)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {number.format(e.people)}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 text-sm">
                        <Icon aria-hidden className={cn('size-3.5 shrink-0', className)} />
                        {normalText(e)}
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
        {data.total > data.events.length && (
          <div className="border-t px-4 py-3">
            <Button asChild variant="outline" size="sm">
              <Link
                href={usageHref(path, state, { show: state.show + EVENTS_PAGE })}
                scroll={false}
              >
                {t('showMore', { shown: data.events.length, total: data.total })}
              </Link>
            </Button>
          </div>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        {data.funnels.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="text-base font-semibold">{t('funnel.title')}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t('funnel.none')}</p>
              <div>
                <FunnelDialog products={products} events={suggestions} />
              </div>
            </CardContent>
          </Card>
        ) : (
          data.funnels.map((f) => (
            <FunnelCard key={f.id} funnel={f} several={several} events={suggestions} />
          ))
        )}
        <Retention cohorts={data.cohorts} scope={product?.name ?? group ?? null} />
      </div>
      {several && <AreaProducts area="usage" setup={setup} folded />}
    </div>
  )
}

/** One funnel: a bar per step, people and the share that continued, and the biggest drop. */
async function FunnelCard({
  funnel,
  several,
  events,
}: {
  funnel: FunnelResult
  several: boolean
  events: string[]
}) {
  const [t, locale] = await Promise.all([getTranslations('usageArea'), getLocale()])
  const number = new Intl.NumberFormat(locale)
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
  const first = funnel.counts[0] ?? 0
  const last = funnel.counts.at(-1) ?? 0
  let drop: { from: string; to: string; share: number } | null = null
  for (let i = 1; i < funnel.counts.length; i++) {
    const before = funnel.counts[i - 1] ?? 0
    if (before === 0) continue
    const lost = 1 - (funnel.counts[i] ?? 0) / before
    if (!drop || lost > drop.share) {
      drop = { from: funnel.steps[i - 1] ?? '', to: funnel.steps[i] ?? '', share: lost }
    }
  }
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <CardTitle>
            <h2 className="text-base font-semibold">
              {several
                ? t('funnel.named', { name: funnel.name, product: funnel.product.name })
                : funnel.name}
            </h2>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t('funnel.meta', {
              days: funnel.windowDays,
              share: first > 0 ? percent.format(last / first) : '–',
            })}
          </p>
        </div>
        <FunnelDialog
          products={[funnel.product]}
          events={events}
          funnel={{
            id: funnel.id,
            slug: funnel.product.slug,
            name: funnel.name,
            steps: funnel.steps,
            windowDays: funnel.windowDays,
          }}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ol
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${funnel.steps.length}, minmax(0, 1fr))` }}
        >
          {funnel.steps.map((step, i) => {
            const count = funnel.counts[i] ?? 0
            const before = i === 0 ? null : (funnel.counts[i - 1] ?? 0)
            const height = first > 0 ? Math.max(2, (count / first) * 100) : 2
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: steps in order; a name may repeat.
              <li key={`${i}-${step}`} className="flex min-w-0 flex-col gap-1.5">
                <span className="truncate text-xs text-muted-foreground" title={step}>
                  {i + 1}. <span className="font-mono">{step}</span>
                </span>
                <div aria-hidden className="flex h-24 items-end rounded-md bg-muted">
                  <div className="w-full rounded-md bg-brand" style={{ height: `${height}%` }} />
                </div>
                <span className="font-display text-lg font-semibold tabular-nums">
                  {number.format(count)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {before === null
                    ? t('funnel.everyone')
                    : t('funnel.continued', {
                        share: before > 0 ? percent.format(count / before) : '–',
                      })}
                </span>
              </li>
            )
          })}
        </ol>
        {drop && drop.share > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('funnel.drop', {
              from: drop.from,
              to: drop.to,
              share: percent.format(drop.share),
            })}
          </p>
        )}
        {first === 0 && <p className="text-xs text-muted-foreground">{t('funnel.empty')}</p>}
      </CardContent>
    </Card>
  )
}

/** "Who comes back": people by the week they signed up and the share active each week after. */
async function Retention({
  cohorts,
  scope,
}: {
  cohorts: { week: string; people: number; active: number[] }[]
  scope: string | null
}) {
  const [t, locale] = await Promise.all([getTranslations('usageArea'), getLocale()])
  const number = new Intl.NumberFormat(locale)
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const weeks = Math.max(0, ...cohorts.map((c) => c.active.length))
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2">
        <CardTitle>
          <h2 className="flex items-center gap-1 text-base font-semibold">
            {scope ? t('retention.titleOf', { scope }) : t('retention.title')}
            <InfoTip label={t('retention.infoLabel')} title={t('retention.title')}>
              {t('retention.info')}
            </InfoTip>
          </h2>
        </CardTitle>
        <span className="text-xs text-muted-foreground">{t('retention.note')}</span>
      </CardHeader>
      <CardContent>
        {cohorts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('retention.none')}</p>
        ) : (
          <Table scrollLabel={t('retention.title')}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('retention.signedUp')}</TableHead>
                <TableHead className="text-right">{t('retention.people')}</TableHead>
                {Array.from({ length: weeks }, (_, k) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: weeks in order.
                  <TableHead key={k} className="text-center">
                    {t('retention.week', { n: k })}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {cohorts.map((c) => (
                <TableRow key={c.week}>
                  <TableCell className="whitespace-nowrap">
                    {t('retention.weekOf', { date: day.format(new Date(`${c.week}T00:00:00Z`)) })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {number.format(c.people)}
                  </TableCell>
                  {Array.from({ length: weeks }, (_, k) => {
                    const n = c.active[k]
                    if (n === undefined) {
                      // biome-ignore lint/suspicious/noArrayIndexKey: weeks in order.
                      return <TableCell key={k} />
                    }
                    const share = c.people > 0 ? n / c.people : 0
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: weeks in order.
                      <TableCell key={k} className="p-1 text-center">
                        <span
                          className={cn(
                            'block rounded-md px-1.5 py-1 text-xs tabular-nums',
                            share >= 0.5 ? 'bg-primary text-primary-foreground' : 'bg-brand/15',
                          )}
                        >
                          {percent.format(share)}
                        </span>
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
