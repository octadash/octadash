import { getProjectBySlug, type ProjectAreaState, type TrafficRow } from '@octadash/db'
import { ArrowRightIcon, SettingsIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { dismissAreaAction, restoreAreaAction } from '@/actions/areas'
import { GetStarted } from '@/components/get-started'
import { MetricChart } from '@/components/metric-chart'
import { StatusDot } from '@/components/status-dot'
import { TvButton } from '@/components/tv-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AREA_ITEMS } from '@/lib/areas'
import { issueTitle } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import { parsePeriod } from '@/lib/period'
import { cn } from '@/lib/utils'
import { services } from '@/server/context'
import { loadGetStarted } from '@/server/get-started'
import type { TimelineItem } from '@/server/overview'
import {
  loadProductPage,
  type MonitorLine,
  type ProductPage as ProductPageData,
} from '@/server/product-page'
import { canManage, requireOrg } from '@/server/session'
import { formatUptime } from '@/server/uptime-view'
import { AreaTiles, areaMetrics, chartLabels, previousAt } from '@/views/overview'
import {
  deltaOf,
  formats,
  HourBar,
  PageHeader,
  Tile,
  Tiles,
  Timeline,
} from '@/views/overview-parts'

type AreaItem = (typeof AREA_ITEMS)[number]
type Translate = Awaited<ReturnType<typeof getTranslations>>

/**
 * The product page, as closed in the panel canvas: the Overview's pattern for
 * one product (numbers, chart, what happened by monitor), then one card per
 * area. An area in use shows its summary; one not set up says what it is for
 * and how it connects; one set up without data shows a blurred example. Areas
 * the owner won't use wait in a folded list.
 */
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ period?: string | string[] }>
}) {
  const [{ slug }, { period: periodParam }] = await Promise.all([params, searchParams])
  const { org } = await requireOrg()
  const project = await getProjectBySlug(services().db, org.id, slug)
  if (!project) notFound()
  const [data, t, tOverview, locale, getStarted] = await Promise.all([
    loadProductPage(org.id, project, parsePeriod(periodParam)),
    getTranslations(),
    getTranslations('overview'),
    getLocale(),
    loadGetStarted(org),
  ])
  const { overview, states, monitors, response } = data
  const { period, timeZone, traffic, uptime, errors } = overview
  const periodName = tOverview(`periods.${period.id}`)
  const format = formats(locale, timeZone, period.id)
  const row = overview.rows[0]
  const manager = canManage(org.role)
  const inUse = AREA_ITEMS.filter((area) => states.get(area.id) !== 'dismissed')
  const dismissed = AREA_ITEMS.filter((area) => states.get(area.id) === 'dismissed')
  const receiving = inUse.filter(
    (area) =>
      (area.id === 'uptime' && monitors.length > 0) ||
      (area.id === 'traffic' && traffic) ||
      (area.id === 'errors' && errors && errors.series.some((p) => p.events > 0)) ||
      (area.id === 'usage' && row?.signups) ||
      (area.id === 'logs' && data.logs?.some((b) => b.error + b.warn + b.info > 0)) ||
      (area.id === 'money' && row?.money) ||
      (area.id === 'costs' && row?.costs),
  ).length
  const waiting = inUse.filter((area) => states.get(area.id) === 'set_up').length - receiving
  const toSetUp = inUse.filter((area) => !states.has(area.id)).length
  const base = `/p/${project.slug}`

  // The product page's timeline is by monitor: one row each.
  const byMonitor = new Map<string, TimelineItem[]>()
  for (const item of overview.timeline[0]?.items ?? []) {
    const name = item.name ?? project.name
    byMonitor.set(name, [...(byMonitor.get(name) ?? []), item])
  }

  const metrics = []
  if (traffic) {
    metrics.push({
      id: 'visitors',
      label: tOverview('chart.visitors'),
      unit: 'count' as const,
      points: traffic.series.map((p, i) => ({
        at: p.at.toISOString(),
        current: p.visitors,
        previous: previousAt(traffic.previousSeries, traffic.series.length, i),
      })),
    })
  }
  if (errors) {
    metrics.push({
      id: 'errors',
      label: tOverview('chart.errors'),
      unit: 'count' as const,
      points: errors.series.map((p, i) => ({
        at: p.at.toISOString(),
        current: p.events,
        previous: previousAt(
          errors.previousSeries.map((q) => ({ visitors: q.events })),
          errors.series.length,
          i,
        ),
      })),
    })
  }
  metrics.push(...areaMetrics(overview, tOverview))
  if (response && response.current.length > 0) {
    const offset = response.previous.length - response.current.length
    metrics.push({
      id: 'response',
      label: tOverview('chart.response'),
      unit: 'ms' as const,
      points: response.current.map((p, i) => ({
        at: p.at.toISOString(),
        current: p.medianMs,
        previous: response.previous[i + offset]?.medianMs ?? null,
      })),
    })
  }

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={t('productPage.status', { receiving, waiting: Math.max(0, waiting), toSetUp })}
        base={base}
        period={period}
        online={traffic ? traffic.online : null}
        actions={
          <>
            <TvButton scope={`p:${project.slug}`} />
            <Button asChild variant="outline">
              <Link href={`${base}/settings`}>
                <SettingsIcon data-icon="inline-start" />
                {t('productPage.settings')}
              </Link>
            </Button>
          </>
        }
        t={tOverview}
      />

      {getStarted && <GetStarted data={getStarted} />}

      {!overview.complete && (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          {tOverview('incomplete')}
        </p>
      )}

      {(uptime || traffic || errors || overview.signups || overview.money || overview.costs) && (
        <Tiles label={tOverview('totals')}>
          {uptime && row && (
            <Tile
              href={`${base}/uptime`}
              label={tOverview('tiles.uptime')}
              area={t('areas.uptime.name')}
              value={
                row.emergency
                  ? tOverview('table.downFor', {
                      duration: format.elapsed(row.emergency.since, period.to),
                    })
                  : statusText(t, row.status)
              }
              sub={tOverview('tiles.uptimeRatio', {
                ratio: formatUptime(uptime.ratio, locale),
                period: periodName,
              })}
              spark={uptime.spark}
              alert={row.status === 'down'}
            />
          )}
          {traffic && (
            <Tile
              href={`${base}/traffic`}
              label={tOverview('tiles.visitors')}
              area={t('areas.traffic.name')}
              value={format.number.format(traffic.visitors)}
              delta={deltaOf(tOverview, traffic.visitors, traffic.previous)}
              sub={tOverview('online', { count: traffic.online })}
              spark={traffic.series.map((p) => p.visitors)}
            />
          )}
          {errors && (
            <Tile
              href={`${base}/errors`}
              label={tOverview('tiles.errors')}
              area={t('areas.errors.name')}
              value={format.number.format(errors.events)}
              delta={fewerIsBetter(deltaOf(tOverview, errors.events, errors.previous))}
              sub={tOverview('tiles.newIssues', { count: errors.newIssues })}
              spark={errors.series.map((p) => p.events)}
            />
          )}
          <AreaTiles overview={overview} base={base} t={tOverview} tRoot={t} locale={locale} />
        </Tiles>
      )}

      {metrics.length > 0 && (
        <MetricChart
          metrics={metrics}
          marks={overview.marks.map((m) => ({ at: m.at.toISOString(), label: project.name }))}
          labels={chartLabels(tOverview, period.id)}
          locale={locale}
          timeZone={timeZone}
          bucket={period.chart}
          span={period.id}
        />
      )}

      {(monitors.length > 0 || traffic) && (
        <Timeline
          title={tOverview('timeline.title', { period: periodName })}
          rows={[...byMonitor].map(([name, items]) => ({
            key: name,
            name,
            href: `${base}/uptime`,
            items,
          }))}
          period={period}
          quiet={null}
          t={tOverview}
          format={format}
        />
      )}

      <section id="areas" aria-labelledby="areas-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="areas-title" className="text-lg font-semibold">
            {t('productPage.areas')}
          </h2>
          <span className="text-sm text-muted-foreground">
            {t('productPage.areasHint', { name: project.name })}
          </span>
        </div>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,22rem),1fr))]">
          {inUse.map((area) =>
            area.id === 'uptime' && monitors.length > 0 ? (
              <UptimeCard
                key={area.id}
                area={area}
                base={base}
                monitors={monitors}
                t={t}
                locale={locale}
              />
            ) : area.id === 'errors' &&
              data.errors &&
              data.errors.days.some((d) => d.events > 0) ? (
              <ErrorsCard
                key={area.id}
                area={area}
                base={base}
                data={data.errors}
                sources={data.sources.filter((s) => s.areas.includes('errors')).length}
                number={format.number}
                t={t}
              />
            ) : area.id === 'traffic' && data.traffic ? (
              <TrafficCard
                key={area.id}
                area={area}
                base={base}
                rows={data.traffic}
                sources={data.sources.filter((s) => s.areas.includes('traffic'))}
                number={format.number}
                t={t}
              />
            ) : area.id === 'logs' &&
              data.logs &&
              data.logs.some((b) => b.error + b.warn + b.info > 0) ? (
              <LogsCard
                key={area.id}
                area={area}
                base={base}
                buckets={data.logs}
                period={periodName}
                number={format.number}
                t={t}
              />
            ) : area.id === 'usage' && row?.signups ? (
              <NumbersCard
                key={area.id}
                area={area}
                href={`${base}/usage`}
                t={t}
                numbers={[
                  {
                    label: tOverview('tiles.signups'),
                    value: format.number.format(row.signups.count),
                    note: t('productPage.numbers.before', {
                      value: format.number.format(row.signups.previous),
                    }),
                  },
                ]}
              />
            ) : area.id === 'money' && row?.money && overview.money ? (
              <NumbersCard
                key={area.id}
                area={area}
                href={`${base}/money`}
                t={t}
                numbers={[
                  {
                    label: tOverview('tiles.revenue'),
                    value: formatMoney(row.money.revenue, overview.money.currency, locale, true),
                    note: periodName,
                  },
                  ...(row.money.mrr === null
                    ? []
                    : [
                        {
                          label: 'MRR',
                          value: formatMoney(row.money.mrr, overview.money.currency, locale, true),
                        },
                      ]),
                ]}
              />
            ) : area.id === 'costs' && row?.costs && overview.costs ? (
              <NumbersCard
                key={area.id}
                area={area}
                href={`${base}/costs`}
                t={t}
                numbers={[
                  {
                    label: tOverview(period.id === '24h' ? 'tiles.costsToday' : 'tiles.costs'),
                    value: formatMoney(row.costs.cost, overview.costs.currency, locale, true),
                  },
                  {
                    label: tOverview('table.margin'),
                    value:
                      row.costs.margin === null
                        ? '–'
                        : `${format.number.format(Math.round(row.costs.margin))}%`,
                    note:
                      row.costs.margin === null ? t('productPage.numbers.noRevenue') : undefined,
                    bad: row.costs.margin !== null && row.costs.margin < 0,
                  },
                ]}
              />
            ) : (
              <AreaCard
                key={area.id}
                area={area}
                state={states.get(area.id)}
                slug={project.slug}
                manager={manager}
                t={t}
              />
            ),
          )}
        </div>
      </section>

      {dismissed.length > 0 && (
        <details className="group rounded-xl border border-border">
          <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-muted-foreground hover:text-foreground">
            {t('productPage.alsoAvailable')} ({dismissed.length})
          </summary>
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {dismissed.map((area) => (
              <li key={area.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <area.icon className="size-4 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium">{t(`areas.${area.id}.name`)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(`areas.${area.id}.body`)}
                  </span>
                </div>
                {manager && (
                  <form action={restoreAreaAction}>
                    <input type="hidden" name="slug" value={project.slug} />
                    <input type="hidden" name="area" value={area.id} />
                    <Button type="submit" variant="outline">
                      {t('productPage.useAgain')}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

function statusText(t: Translate, status: string) {
  return (
    {
      up: t('uptime.statusUp'),
      down: t('uptime.statusDown'),
      unknown: t('uptime.statusUnknown'),
      none: t('uptime.statusPaused'),
    }[status] ?? ''
  )
}

function UptimeCard({
  area,
  base,
  monitors,
  t,
  locale,
}: {
  area: AreaItem
  base: string
  monitors: MonitorLine[]
  t: Translate
  locale: string
}) {
  const down = monitors.some((m) => !m.paused && m.status === 'down')
  const cert = monitors
    .map((m) => m.certDays)
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b)[0]
  return (
    <section
      aria-labelledby="card-uptime"
      className={cn(
        'flex flex-col gap-4 rounded-xl border bg-card p-5',
        down ? 'border-error/60' : 'border-border',
      )}
    >
      <header className="flex items-center gap-2.5">
        <area.icon aria-hidden className="size-4 text-muted-foreground" />
        <h3 id="card-uptime" className="font-display text-lg font-semibold">
          {t('areas.uptime.name')}
        </h3>
        <span className="ml-auto text-xs text-muted-foreground">
          {t('productPage.monitors30', { count: monitors.length })}
        </span>
      </header>
      <ul className="flex flex-col gap-3">
        {monitors.map((m) => (
          <li key={m.id} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusDot status={m.paused ? 'paused' : m.status} />
              <span className="font-medium">{m.name}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {[
                  m.paused ? t('uptime.statusPaused') : statusText(t, m.status),
                  formatUptime(m.uptime, locale),
                  m.medianMs === null ? null : `${m.medianMs} ms`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <HourBar hours={m.days} className="w-full" />
          </li>
        ))}
      </ul>
      {cert !== undefined && cert <= 14 && (
        <p className="text-sm text-warn">{t('productPage.certSoon', { count: cert })}</p>
      )}
      <Link
        href={`${base}/uptime`}
        className="mt-auto self-start text-sm text-brand hover:underline"
      >
        {t('productPage.open', { area: t('areas.uptime.name') })}
        <ArrowRightIcon aria-hidden className="ml-1 inline size-3.5" />
      </Link>
    </section>
  )
}

function TrafficCard({
  area,
  base,
  rows,
  sources,
  number,
  t,
}: {
  area: AreaItem
  base: string
  rows: Record<'source' | 'page' | 'country' | 'device', TrafficRow[]>
  sources: { name: string; platform: string }[]
  number: Intl.NumberFormat
  t: Translate
}) {
  const tabs = ['source', 'page', 'country', 'device'] as const
  return (
    <section
      aria-labelledby="card-traffic"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5"
    >
      <header className="flex flex-wrap items-center gap-2.5">
        <area.icon aria-hidden className="size-4 text-muted-foreground" />
        <h3 id="card-traffic" className="font-display text-lg font-semibold">
          {t('areas.traffic.name')}
        </h3>
        {sources.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {sources.map((s) => `${s.name} · ${s.platform}`).join(', ')}
          </span>
        )}
      </header>
      <Tabs defaultValue="source" className="gap-3">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`productPage.trafficTabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => {
          const list = rows[tab]
          const max = Math.max(1, ...list.map((r) => r.visitors))
          return (
            <TabsContent key={tab} value={tab}>
              {list.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('productPage.noVisits')}</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {list.map((r) => (
                    <li
                      key={r.value}
                      className="relative flex items-center justify-between gap-3 px-2 py-1 text-sm"
                    >
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 rounded bg-brand/15"
                        style={{ width: `${(r.visitors / max) * 100}%` }}
                      />
                      <span className="relative truncate">
                        {r.value || t(`productPage.unknown.${tab}`)}
                      </span>
                      <span className="relative tabular-nums">{number.format(r.visitors)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          )
        })}
      </Tabs>
      <Link
        href={`${base}/traffic`}
        className="mt-auto self-start text-sm text-brand hover:underline"
      >
        {t('productPage.open', { area: t('areas.traffic.name') })}
        <ArrowRightIcon aria-hidden className="ml-1 inline size-3.5" />
      </Link>
    </section>
  )
}

/** For errors fewer is better: a drop reads as good, a rise does not. */
function fewerIsBetter<T extends { up: boolean; down: boolean }>(delta: T | null): T | null {
  return delta ? { ...delta, up: delta.down, down: delta.up } : null
}

function ErrorsCard({
  area,
  base,
  data,
  sources,
  number,
  t,
}: {
  area: AreaItem
  base: string
  data: NonNullable<ProductPageData['errors']>
  sources: number
  number: Intl.NumberFormat
  t: Translate
}) {
  const max = Math.max(1, ...data.days.map((d) => d.events))
  const total = data.days.reduce((sum, d) => sum + d.events, 0)
  return (
    <section
      aria-labelledby="card-errors"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5"
    >
      <header className="flex flex-wrap items-center gap-2.5">
        <area.icon aria-hidden className="size-4 text-muted-foreground" />
        <h3 id="card-errors" className="font-display text-lg font-semibold">
          {t('areas.errors.name')}
        </h3>
        {sources > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {t('productPage.errorSources', { count: sources })}
          </span>
        )}
      </header>
      {data.issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('productPage.noIssues')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.issues.map((issue) => (
            <li key={issue.id} className="flex flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <Link
                  href={`${base}/errors/${issue.id}`}
                  className="text-sm font-medium break-words hover:text-brand hover:underline"
                >
                  {issueTitle(issue)}
                </Link>
                {issue.isNew && <Badge variant="brand">{t('errorsArea.badges.new')}</Badge>}
              </span>
              <span className="text-xs text-muted-foreground">
                {[
                  issue.culprit,
                  t('productPage.issueNumbers', { events: issue.events, people: issue.people }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex flex-col gap-1">
        <div aria-hidden className="flex h-10 items-end gap-1">
          {data.days.map((d) => (
            <span
              key={d.at.toISOString()}
              className="flex-1 rounded-sm bg-error/60"
              style={{ height: `${Math.max(4, (d.events / max) * 100)}%` }}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {t('productPage.errorDays', { total: number.format(total) })}
        </p>
      </div>
      <Link href={`${base}/errors`} className="self-start text-sm text-brand hover:underline">
        {t('productPage.open', { area: t('areas.errors.name') })}
        <ArrowRightIcon aria-hidden className="ml-1 inline size-3.5" />
      </Link>
    </section>
  )
}

/** Lines per slice of the period, errors and warnings apart. */
function LogsCard({
  area,
  base,
  buckets,
  period,
  number,
  t,
}: {
  area: AreaItem
  base: string
  buckets: NonNullable<ProductPageData['logs']>
  period: string
  number: Intl.NumberFormat
  t: Translate
}) {
  const total = (b: (typeof buckets)[number]) => b.error + b.warn + b.info
  const max = Math.max(1, ...buckets.map(total))
  const sum = (key: 'error' | 'warn' | 'info') => buckets.reduce((n, b) => n + b[key], 0)
  const errors = sum('error')
  const warnings = sum('warn')
  const lines = errors + warnings + sum('info')
  return (
    <section
      aria-labelledby="card-logs"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5"
    >
      <header className="flex items-center gap-2.5">
        <area.icon aria-hidden className="size-4 text-muted-foreground" />
        <h3 id="card-logs" className="font-display text-lg font-semibold">
          {t('areas.logs.name')}
        </h3>
      </header>
      <dl className="grid grid-cols-3 gap-4">
        {(
          [
            ['lines', lines, ''],
            ['errors', errors, errors > 0 ? 'text-error' : ''],
            ['warnings', warnings, ''],
          ] as const
        ).map(([key, value, tone]) => (
          <div key={key} className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted-foreground">{t(`productPage.logs.${key}`)}</dt>
            <dd className={cn('font-display text-2xl font-semibold tabular-nums', tone)}>
              {number.format(value)}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto flex flex-col gap-1">
        <div aria-hidden className="flex h-10 items-end gap-1">
          {buckets.map((b) => (
            <span
              key={b.at.toISOString()}
              className="flex flex-1 flex-col-reverse overflow-hidden rounded-sm"
              style={{ height: `${Math.max(4, (total(b) / max) * 100)}%` }}
            >
              <span
                className="bg-muted-foreground/40"
                style={{ flexGrow: b.info || (total(b) ? 0 : 1) }}
              />
              <span className="bg-warn/70" style={{ flexGrow: b.warn }} />
              <span className="bg-error/70" style={{ flexGrow: b.error }} />
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('productPage.logs.bars', { period })}</p>
      </div>
      <Link href={`${base}/logs`} className="self-start text-sm text-brand hover:underline">
        {t('productPage.open', { area: t('areas.logs.name') })}
        <ArrowRightIcon aria-hidden className="ml-1 inline size-3.5" />
      </Link>
    </section>
  )
}

/** A set-up area's few numbers, for areas whose page has the detail. */
function NumbersCard({
  area,
  href,
  numbers,
  t,
}: {
  area: AreaItem
  href: string
  numbers: { label: string; value: string; note?: string; bad?: boolean }[]
  t: Translate
}) {
  return (
    <section
      aria-labelledby={`card-${area.id}`}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5"
    >
      <header className="flex items-center gap-2.5">
        <area.icon aria-hidden className="size-4 text-muted-foreground" />
        <h3 id={`card-${area.id}`} className="font-display text-lg font-semibold">
          {t(`areas.${area.id}.name`)}
        </h3>
      </header>
      <dl className="grid grid-cols-2 gap-4">
        {numbers.map((n) => (
          <div key={n.label} className="flex flex-col gap-0.5">
            <dt className="text-sm text-muted-foreground">{n.label}</dt>
            <dd
              className={cn(
                'font-display text-2xl font-semibold tabular-nums',
                n.bad && 'text-error',
              )}
            >
              {n.value}
            </dd>
            {n.note && <dd className="text-xs text-muted-foreground">{n.note}</dd>}
          </div>
        ))}
      </dl>
      <Link href={href} className="mt-auto self-start text-sm text-brand hover:underline">
        {t('productPage.open', { area: t(`areas.${area.id}.name`) })}
        <ArrowRightIcon aria-hidden className="ml-1 inline size-3.5" />
      </Link>
    </section>
  )
}

function AreaCard({
  area,
  state,
  slug,
  manager,
  t,
}: {
  area: AreaItem
  state: ProjectAreaState | undefined
  slug: string
  manager: boolean
  t: Awaited<ReturnType<typeof getTranslations>>
}) {
  const setUp = state === 'set_up'
  return (
    <section
      className={cn(
        'flex flex-col gap-4 rounded-xl p-5 md:min-h-72',
        setUp ? 'border border-border bg-card' : 'border border-dashed border-input bg-card/50',
      )}
    >
      <header className="flex items-center gap-2.5">
        <area.icon className="size-4 text-muted-foreground" />
        <h2 className="font-display text-lg font-semibold">{t(`areas.${area.id}.name`)}</h2>
      </header>
      {setUp ? (
        <div className="relative flex flex-1 flex-col justify-end">
          <div aria-hidden className="flex flex-1 items-end gap-1.5 blur-[3px]">
            {[40, 62, 48, 75, 55, 82, 68, 90, 72, 60].map((h) => (
              <span key={h} className="flex-1 rounded-sm bg-brand/30" style={{ height: `${h}%` }} />
            ))}
          </div>
          <span className="absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground">
            {t('productPage.example')}
          </span>
        </div>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-foreground/85">{t(`areas.${area.id}.body`)}</p>
          <p className="text-sm text-muted-foreground">{t(`areas.${area.id}.how`)}</p>
          <div className="mt-auto flex flex-wrap gap-2">
            <Button asChild size="lg" className="px-4">
              <Link
                href={
                  area.id === 'errors' ||
                  area.id === 'traffic' ||
                  area.id === 'usage' ||
                  area.id === 'logs' ||
                  area.id === 'money' ||
                  area.id === 'costs'
                    ? `/p/${slug}/${area.id}/setup`
                    : `/p/${slug}/${area.id}`
                }
              >
                {t('productPage.setUp')}
              </Link>
            </Button>
            {manager && (
              <form action={dismissAreaAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="area" value={area.id} />
                <Button type="submit" variant="ghost" size="lg" className="text-muted-foreground">
                  {t('productPage.wontUse')}
                </Button>
              </form>
            )}
          </div>
        </>
      )}
    </section>
  )
}
