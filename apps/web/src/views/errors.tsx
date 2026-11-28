import { ISSUE_TABS } from '@octadash/db'
import { DiamondIcon, PlusIcon, SquareIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { IssueButton, IssueMenu } from '@/components/issue-actions'
import { MetricChart } from '@/components/metric-chart'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ERROR_PERIODS,
  ERROR_SORTS,
  type ErrorMetric,
  type ErrorsState,
  errorsHref,
  ISSUES_PAGE,
  issueTitle,
} from '@/lib/errors'
import { percentChange } from '@/lib/period'
import { cn } from '@/lib/utils'
import { type IssueRow, loadErrors } from '@/server/errors'
import { AreaProducts } from './area-start'
import { ignoreLabels } from './error-labels'
import { ErrorsQuiet, ErrorsStartView } from './errors-empty'

/** Bars of the last 24 hours, one per hour; the numbers are in the row's Events cell. */
function Bars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values)
  return (
    <svg role="img" aria-label={label} viewBox="0 0 96 24" className="h-6 w-24">
      {values.map((v, i) => {
        const h = v === 0 ? 1 : Math.max(2, (v / max) * 24)
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: one bar per hour, in order.
            key={i}
            x={i * 4}
            y={24 - h}
            width={3}
            height={h}
            className={v === 0 ? 'fill-muted' : 'fill-brand'}
          />
        )
      })}
    </svg>
  )
}

/** ▲ unhandled, ■ handled, ◆ a warning: shape and word, never color alone. */
export function IssueIcon({
  issue,
  labels,
}: {
  issue: { handled: boolean; level: string }
  labels: { unhandled: string; handled: string; warning: string }
}) {
  const kind = issue.level === 'warning' ? 'warning' : issue.handled ? 'handled' : 'unhandled'
  const Icon =
    kind === 'warning' ? DiamondIcon : kind === 'handled' ? SquareIcon : TriangleAlertIcon
  return (
    <span className="flex items-center">
      <Icon
        aria-hidden
        className={cn(
          'size-4',
          kind === 'unhandled' && 'text-error',
          kind === 'warning' && 'text-warn',
          kind === 'handled' && 'text-muted-foreground',
        )}
      />
      <span className="sr-only">{labels[kind]}</span>
    </span>
  )
}

/**
 * The Errors list, as closed in the Errors canvas: numbers on top that switch
 * the chart, the chart against the period before, then the issues with their
 * tabs. Same error in the same place is one issue. Every product (`projectIds`
 * null), a group or one product.
 */
export async function ErrorsView({
  orgId,
  userId,
  projectIds,
  path,
  state,
  group,
  product,
}: {
  orgId: string
  userId: string
  projectIds: string[] | null
  /** "/all/errors", "/g/<slug>/errors", "/p/<slug>/errors". */
  path: string
  state: ErrorsState
  group?: string
  product?: { name: string; slug: string }
}) {
  const [data, t, format, locale] = await Promise.all([
    loadErrors(orgId, userId, projectIds, state),
    getTranslations('errorsArea'),
    getFormatter(),
    getLocale(),
  ])
  const number = new Intl.NumberFormat(locale)
  const now = new Date()
  const ago = (date: Date) => format.relativeTime(date, now)
  const several = data.projects.length > 1
  const anyIssue = Object.values(data.counts).some((n) => n > 0)

  const sendingSetup = data.setup.filter((s) => s.state === 'sending')
  // Never sent an error: how to start. Sent before, nothing now and nothing
  // open: a quiet period, said as such instead of zeros.
  const quiet =
    data.totals.events === 0 && data.counts.unresolved === 0 && state.tab === 'unresolved'

  if (!anyIssue && data.totals.events === 0 && sendingSetup.length === 0) {
    const [first] = data.setup
    if (product && first) {
      return <ErrorsStartView orgId={orgId} product={product} setup={first} />
    }
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {group ? t('introGroup', { group }) : t('intro')}
          </p>
        </div>
        <AreaProducts area="errors" setup={data.setup} folded={false} />
      </div>
    )
  }

  const change = (current: number, before: number, kind: 'percent' | 'count') => {
    if (kind === 'count') {
      const d = current - before
      return d === 0 ? null : { text: `${d > 0 ? '↑' : '↓'} ${Math.abs(d)}`, up: d > 0, c: d }
    }
    const c = percentChange(current, before)
    return c === null || c === 0
      ? null
      : { text: `${c > 0 ? '↑' : '↓'} ${Math.abs(c)}%`, up: c > 0, c }
  }
  const tiles: {
    id: ErrorMetric | 'newIssues'
    value: number
    delta: ReturnType<typeof change>
    note?: string
  }[] = [
    {
      id: 'events',
      value: data.totals.events,
      delta: change(data.totals.events, data.previous.events, 'percent'),
    },
    {
      id: 'issues',
      value: data.totals.issues,
      delta: change(data.totals.issues, data.previous.issues, 'count'),
    },
    {
      id: 'newIssues',
      value: data.totals.newIssues,
      delta: null,
      note: t(`since.${state.period}`),
    },
    {
      id: 'people',
      value: data.totals.people,
      delta: change(data.totals.people, data.previous.people, 'percent'),
    },
  ]
  const offset = data.previousSeries.length - data.series.length
  const points = data.series.map((p, i) => ({
    at: p.at.toISOString(),
    current: p[state.metric],
    previous: data.previousSeries[i + offset]?.[state.metric] ?? null,
  }))
  const labels = {
    unhandled: t('kind.unhandled'),
    handled: t('kind.handled'),
    warning: t('kind.warning'),
  }
  const ignore = await ignoreLabels()

  const when = (issue: IssueRow) => {
    if (issue.regressed_at && issue.status === 'unresolved') {
      return issue.last_release
        ? t('when.backIn', { release: issue.last_release, ago: ago(issue.regressed_at) })
        : t('when.back', { ago: ago(issue.regressed_at) })
    }
    if (issue.first_release && now.getTime() - issue.first_seen.getTime() < 2 * 86_400_000) {
      return t('when.since', { release: issue.first_release, ago: ago(issue.first_seen) })
    }
    return t('when.first', { ago: ago(issue.first_seen) })
  }

  const intro = product
    ? t('introOne', { product: product.name })
    : group
      ? t('introGroup', { group })
      : t('intro')

  const header = (
    <>
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
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={`/p/${product.slug}/errors/setup?add=1#add`}>
                  <PlusIcon data-icon="inline-start" aria-hidden />
                  {t('addSource')}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={`/p/${product.slug}/errors/setup`}>{t('setUp')}</Link>
              </Button>
            </>
          )}
          <nav aria-label={t('periodLabel')} className="flex rounded-lg border border-border p-0.5">
            {ERROR_PERIODS.map((id) => (
              <Link
                key={id}
                href={errorsHref(path, state, { period: id })}
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
        </div>
      </div>

      {!data.complete && (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          {t('incomplete')}
        </p>
      )}
    </>
  )

  if (quiet) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ErrorsQuiet
          orgId={orgId}
          from={data.period.from}
          setup={sendingSetup}
          path={path}
          state={state}
          several={several}
          resolved={data.counts.resolved}
        />
        {several && <AreaProducts area="errors" setup={data.setup} folded />}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <section
        aria-label={t('tiles.label')}
        className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      >
        {tiles.map((tile) => {
          const body = (
            <>
              <span className="text-sm text-muted-foreground">{t(`tiles.${tile.id}`)}</span>
              <span className="flex items-baseline gap-2">
                <span className="font-display text-2xl font-semibold tabular-nums">
                  {number.format(tile.value)}
                </span>
                {tile.delta && (
                  <span
                    className={cn(
                      'text-sm tabular-nums',
                      tile.delta.up ? 'text-error' : 'text-muted-foreground',
                    )}
                  >
                    {tile.delta.text}
                    <span className="sr-only"> {t('change', { change: tile.delta.c })}</span>
                  </span>
                )}
              </span>
              {tile.note && <span className="text-xs text-muted-foreground">{tile.note}</span>}
            </>
          )
          return tile.id === 'newIssues' ? (
            <div
              key={tile.id}
              className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4"
            >
              {body}
            </div>
          ) : (
            <Link
              key={tile.id}
              href={errorsHref(path, state, { metric: tile.id })}
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
        metrics={[{ id: state.metric, label: t(`tiles.${state.metric}`), unit: 'count', points }]}
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

      <section aria-labelledby="issues-title" className="flex flex-col gap-3">
        <h2 id="issues-title" className="sr-only">
          {t('issues')}
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav
            aria-label={t('tabsLabel')}
            className="flex flex-wrap rounded-lg border border-border p-0.5"
          >
            {ISSUE_TABS.map((tab) => (
              <Link
                key={tab}
                href={errorsHref(path, state, { tab, show: ISSUES_PAGE })}
                aria-current={tab === state.tab ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground',
                  tab === state.tab && 'bg-secondary font-medium text-foreground',
                )}
              >
                {t(`tabs.${tab}`)}
                {data.counts[tab] > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {number.format(data.counts[tab])}
                  </span>
                )}
              </Link>
            ))}
          </nav>
          <nav aria-label={t('sortLabel')} className="flex flex-wrap items-center gap-1 text-sm">
            <span className="text-muted-foreground">{t('sortLabel')}:</span>
            {ERROR_SORTS.map((sort) => (
              <Link
                key={sort}
                href={errorsHref(path, state, { sort })}
                aria-current={sort === state.sort ? 'true' : undefined}
                className={cn(
                  'rounded-md px-2 py-1 text-muted-foreground hover:text-foreground',
                  sort === state.sort && 'font-medium text-foreground underline underline-offset-4',
                )}
              >
                {t(`sorts.${sort}`)}
              </Link>
            ))}
          </nav>
        </div>

        <Card className="py-0">
          {data.issues.length === 0 ? (
            <CardContent className="py-6 text-sm text-muted-foreground">
              {t(`empty.${state.tab}`)}
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <span className="sr-only">{t('columns.kind')}</span>
                  </TableHead>
                  <TableHead>{t('columns.issue')}</TableHead>
                  <TableHead className="hidden md:table-cell">{t('columns.last24')}</TableHead>
                  <TableHead className="text-right">{t('columns.events')}</TableHead>
                  <TableHead className="text-right">{t('columns.people')}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t('columns.onIt')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('columns.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.issues.map((issue) => {
                  const title = issueTitle(issue)
                  const href = `/p/${issue.product.slug}/errors/${issue.id}`
                  const isNew = issue.first_seen >= data.period.from
                  const regressed = issue.regressed_at !== null && issue.status === 'unresolved'
                  return (
                    <TableRow key={issue.id}>
                      <TableCell className="align-top">
                        <IssueIcon issue={issue} labels={labels} />
                      </TableCell>
                      <TableCell className="max-w-0 min-w-64 whitespace-normal">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={href}
                            className="truncate font-medium hover:underline"
                            title={title}
                          >
                            {title}
                          </Link>
                          {isNew && <Badge variant="brand">{t('badges.new')}</Badge>}
                          {regressed && <Badge variant="warn">{t('badges.regressed')}</Badge>}
                          {issue.spike && <Badge variant="destructive">{t('spike')}</Badge>}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {issue.culprit && <span className="font-mono">{issue.culprit}</span>}
                          {[
                            several || !product ? issue.product.name : null,
                            issue.source,
                            when(issue),
                          ]
                            .filter(Boolean)
                            .map((part) => ` · ${part}`)
                            .join('')}
                        </p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Bars
                          values={issue.spark}
                          label={t('bars', {
                            count: issue.spark.reduce((a, b) => a + b, 0),
                          })}
                        />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {number.format(issue.events)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {issue.people > 0 ? number.format(issue.people) : '—'}
                      </TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">
                        {issue.acknowledged_by_name && issue.acknowledged_at ? (
                          <span className="flex items-center gap-1.5">
                            <span aria-hidden className="size-2 rounded-full bg-ok" />
                            {t('onIt', {
                              name: issue.acknowledged_by_name,
                              ago: ago(issue.acknowledged_at),
                            })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{t('nobody')}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {issue.status === 'unresolved' ? (
                            <IssueButton
                              issueId={issue.id}
                              kind="resolve"
                              label={t('actions.resolve')}
                              variant="outline"
                              size="sm"
                              name={title}
                            />
                          ) : (
                            <IssueButton
                              issueId={issue.id}
                              kind="reopen"
                              label={t('actions.reopen')}
                              variant="outline"
                              size="sm"
                              name={title}
                            />
                          )}
                          <IssueMenu
                            issueId={issue.id}
                            href={href}
                            name={title}
                            labels={{
                              more: t('actions.more'),
                              open: t('actions.open'),
                              nextRelease: t('actions.nextRelease'),
                              ignore: t('actions.ignore'),
                            }}
                            ignore={ignore}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </Card>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          {data.total > 0 && (
            <p>
              {t('showing', { shown: data.issues.length, total: data.total })}
              {data.total > data.issues.length && (
                <>
                  {' · '}
                  <Link
                    href={errorsHref(path, state, { show: state.show + ISSUES_PAGE })}
                    className="text-brand underline underline-offset-4"
                  >
                    {t('loadMore')}
                  </Link>
                </>
              )}
            </p>
          )}
          <p>{t('foot')}</p>
        </div>
      </section>
      {several && <AreaProducts area="errors" setup={data.setup} folded />}
    </div>
  )
}
