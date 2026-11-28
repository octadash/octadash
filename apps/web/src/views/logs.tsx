import { BellRingIcon } from 'lucide-react'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { AddSourceAction } from '@/components/add-source-action'
import { LogExplorer } from '@/components/log-explorer'
import { LogHistogram } from '@/components/log-histogram'
import { LogSearchDialog } from '@/components/log-search-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LOG_PERIODS, type LogsState, logsHref } from '@/lib/logs'
import { cn } from '@/lib/utils'
import { loadAreaSetup } from '@/server/area-setup'
import { loadLogs } from '@/server/logs'
import { AreaProducts, AreaProductsPage } from './area-start'
import { LogsStartView } from './area-start-views'

/**
 * Logs, as closed in the Logs canvas: one search box over every line, a
 * histogram by level, Live, and the saved searches on the left (one with
 * Alert on is the "Log alert" emergency). Every product (`projectIds` null),
 * a group or one product.
 */
export async function LogsView({
  orgId,
  projectIds,
  path,
  scope,
  state,
  canManage,
  product,
}: {
  orgId: string
  projectIds: string[] | null
  /** "/all/logs", "/g/<slug>/logs", "/p/<slug>/logs". */
  path: string
  /** For the browser's requests: `all`, `g:<slug>` or `p:<slug>`. */
  scope: string
  state: LogsState
  canManage: boolean
  product?: { name: string; slug: string }
}) {
  const [data, t, locale] = await Promise.all([
    loadLogs(orgId, projectIds, state),
    getTranslations('logsArea'),
    getLocale(),
  ])
  const number = new Intl.NumberFormat(locale)
  const several = data.projects.length > 1

  const setup = await loadAreaSetup(orgId, data.projects, 'logs')
  if (!data.anyLine && !setup.some((s) => s.state === 'sending')) {
    const [first] = setup
    if (product && first) return <LogsStartView orgId={orgId} product={product} setup={first} />
    return (
      <AreaProductsPage title={t('title')} intro={t('intro')}>
        <AreaProducts area="logs" setup={setup} folded={false} />
      </AreaProductsPage>
    )
  }

  const kept =
    data.retention.min === data.retention.max
      ? t('kept', { days: data.retention.min })
      : t('keptRange', { min: data.retention.min, max: data.retention.max })
  const intro = product ? t('introProduct', { name: product.name }) : t('intro')

  const header = (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm">
          <span className="font-semibold tabular-nums">
            {t('lines', { count: data.total, formatted: number.format(data.total) })}
          </span>{' '}
          <span className="text-muted-foreground">{t(`in.${state.period}`)}</span>
        </p>
        <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-error" />
            {t('levels.error')}
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-warn" />
            {t('levels.warn')}
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-sm bg-muted-foreground" />
            {t('levels.info')}
          </li>
        </ul>
      </div>
      <LogHistogram
        bars={data.histogram.map((b) => ({ ...b, at: b.at.toISOString() }))}
        labels={{
          error: t('levels.error'),
          warn: t('levels.warn'),
          info: t('levels.info'),
          asTable: t('asTable'),
          time: t('list.time'),
        }}
        locale={locale}
        timeZone={data.timeZone}
        long={state.period === '7d' || state.period === '30d'}
      />
    </>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {intro} {kept}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {product && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/p/${product.slug}/logs/setup`}>{t('setUp')}</Link>
            </Button>
          )}
          <nav aria-label={t('periodLabel')} className="flex rounded-lg border border-border p-0.5">
            {LOG_PERIODS.map((id) => (
              <Link
                key={id}
                href={logsHref(path, state, { period: id })}
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
          <AddSourceAction
            area="logs"
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
      {data.unknownProducts.length > 0 && (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          {t('unknownProduct', { names: data.unknownProducts.join(', ') })}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Card className="order-2 h-fit lg:order-1">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">{t('saved.title')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.searches.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('saved.none')}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {data.searches.map((s) => {
                  const current = s.query === state.q
                  return (
                    <li
                      key={s.id}
                      className={cn(
                        'flex items-start gap-1 rounded-lg p-2',
                        current && 'bg-secondary',
                      )}
                    >
                      <Link
                        href={logsHref(path, state, { q: s.query })}
                        aria-current={current ? 'true' : undefined}
                        className="flex min-w-0 flex-1 flex-col gap-0.5"
                      >
                        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                          {s.name}
                          {s.alert && (
                            <Badge variant="secondary" className="gap-1">
                              <BellRingIcon aria-hidden className="size-3" />
                              {t('saved.alert')}
                            </Badge>
                          )}
                        </span>
                        <span className="truncate font-mono text-xs text-muted-foreground">
                          {s.query}
                        </span>
                      </Link>
                      <LogSearchDialog
                        query={s.query}
                        search={{ id: s.id, name: s.name, query: s.query, alert: s.alert }}
                        canAlert={canManage}
                      />
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{t('saved.note')}</p>
          </CardContent>
        </Card>

        <div className="order-1 min-w-0 lg:order-2">
          <LogExplorer
            initial={data.lines}
            scope={scope}
            q={state.q}
            period={state.period}
            path={path}
            liveDefault={state.live}
            several={several}
            locale={locale}
            timeZone={data.timeZone}
            withDate={state.period === '7d' || state.period === '30d'}
            saveButton={<LogSearchDialog query={state.q} canAlert={canManage} />}
            header={header}
            labels={{
              search: t('list.search'),
              searchPlaceholder: t('list.searchPlaceholder'),
              searchButton: t('list.searchButton'),
              live: t('list.live'),
              liveOn: t('list.liveOn'),
              paused: t('list.paused'),
              backToTop: t('list.backToTop'),
              newLines: t('list.newLines'),
              loadOlder: t('list.loadOlder'),
              noOlder: t('list.noOlder'),
              loading: t('list.loading'),
              failed: t('list.failed'),
              attributes: t('list.attributes'),
              resource: t('list.resource'),
              trace: t('list.trace'),
              traceLines: t('list.traceLines'),
              errorsInTrace: t('list.errorsInTrace'),
              span: t('list.span'),
              scope: t('list.scope'),
              masked: t('list.masked'),
              addToSearch: t('list.addToSearch'),
              empty: state.q ? t('list.noMatch') : t('list.empty'),
              time: t('list.time'),
              level: t('list.level'),
              service: t('list.service'),
              product: t('list.product'),
              message: t('list.message'),
            }}
          />
        </div>
      </div>
      {several && <AreaProducts area="logs" setup={setup} folded />}
    </div>
  )
}
