import { getProjectBySlug, listSources, sentryDsn, sourcesLastData } from '@octadash/db'
import {
  BellRingIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  LayersIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { dismissAreaAction, restoreAreaAction } from '@/actions/areas'
import { addErrorsToSourceAction } from '@/actions/error-sources'
import { ErrorsInstall } from '@/components/errors-install'
import { ErrorsStart } from '@/components/errors-start'
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
import { type ErrorsState, errorsHref, issueTitle } from '@/lib/errors'
import { isErrorPlatform } from '@/lib/errors-setup'
import { services } from '@/server/context'
import type { ProductSetup } from '@/server/errors'
import { canManage, requireOrg } from '@/server/session'

const AREA_ORDER = ['traffic', 'usage', 'logs', 'errors', 'money', 'costs', 'uptime']

/** "page views and events": what a source already sends, in the setup page's words. */
async function sendsWhat(areas: string[]) {
  const [t, format] = await Promise.all([getTranslations('errorsSetup'), getFormatter()])
  const names = AREA_ORDER.filter((a) => areas.includes(a) && t.has(`areaNames.${a}`)).map((a) =>
    t(`areaNames.${a}` as 'areaNames.traffic'),
  )
  return names.length > 0 ? format.list(names, { type: 'conjunction' }) : null
}

/** "Use {source}": the source's key starts sending errors, and the page shows its code. */
function UseSource({
  slug,
  source,
  label,
  variant,
}: {
  slug: string
  source: string
  label: string
  variant?: 'default' | 'outline'
}) {
  return (
    <form action={addErrorsToSourceAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="next" value="errors" />
      <Button type="submit" size="sm" variant={variant}>
        {label}
      </Button>
    </form>
  )
}

/** How the page will look once errors arrive: made-up numbers, marked as an example. */
async function Example() {
  const t = await getTranslations('errorsArea.start')
  const tiles = t.raw('exampleTiles') as { label: string; value: string; note: string }[]
  const issues = t.raw('exampleIssues') as { badge: string; title: string; meta: string }[]
  return (
    <section
      aria-label={t('exampleLabel')}
      className="flex flex-col gap-4 rounded-xl border border-border bg-muted/30 p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('example')}</h2>
        <Badge variant="outline">{t('exampleBadge')}</Badge>
      </div>
      <dl className="grid grid-cols-3 gap-2">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-card p-3"
          >
            <dt className="truncate text-xs text-muted-foreground">{tile.label}</dt>
            <dd className="font-display text-xl font-semibold tabular-nums">{tile.value}</dd>
            <dd className="text-xs text-muted-foreground">{tile.note}</dd>
          </div>
        ))}
      </dl>
      <ul className="flex flex-col gap-3">
        {issues.map((issue) => (
          <li key={issue.title} className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              {issue.badge && <Badge variant="secondary">{issue.badge}</Badge>}
              <code className="min-w-0 font-mono text-xs font-medium break-words">
                {issue.title}
              </code>
            </span>
            <span className="text-xs text-muted-foreground">{issue.meta}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card p-3 font-mono text-xs">
        <span className="text-muted-foreground">{t('exampleFile')}</span>
        {(t.raw('exampleCode') as string[]).map((line, i) => (
          <span key={line} className={i === 1 ? 'rounded bg-error/10 px-1 -mx-1' : undefined}>
            {line}
          </span>
        ))}
      </div>
    </section>
  )
}

/**
 * Errors of one product before the first error, as closed in the empty-state
 * canvas: what Errors gives, then the shortest next step for where the
 * product stands (start from where the code runs, use a source it already
 * has, or the code and a live wait for the one set up), beside an example of
 * the page, and what comes with it.
 */
export async function ErrorsStartView({
  orgId,
  product,
  setup,
}: {
  orgId: string
  product: { name: string; slug: string }
  setup: ProductSetup
}) {
  const { db, env } = services()
  const [{ org }, t, project] = await Promise.all([
    requireOrg(),
    getTranslations('errorsArea.start'),
    getProjectBySlug(db, orgId, product.slug),
  ])
  const manager = canManage(org.role)
  const sources = project ? await listSources(db, orgId, project.id) : []
  const source = sources.find((s) => s.id === setup.source?.id)
  const ingest = env.OCTADASH_INGEST_URL
  const errorsPath = `/p/${product.slug}/errors`
  const features = t.raw('features') as { title: string; body: string }[]
  const icons = [LayersIcon, BellRingIcon, ShieldCheckIcon]

  let step: React.ReactNode
  if (setup.state === 'waiting' && source?.public_key && project) {
    const dsn = sentryDsn(ingest, source.public_key, String(project.ingest_id))
    step = (
      <div className="flex flex-col gap-4">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckIcon aria-hidden className="size-4 text-ok" />
          {t('waiting', { source: source.name })}
        </p>
        <ErrorsInstall
          key={source.id}
          sourceId={source.id}
          ingestUrl={ingest}
          publicKey={source.public_key}
          dsn={dsn}
          platform={isErrorPlatform(source.platform) ? source.platform : 'other'}
          issueHref={errorsPath}
          errorsHref={errorsPath}
          level={2}
        />
      </div>
    )
  } else if (!manager) {
    step = <p className="text-sm text-muted-foreground">{t('viewer')}</p>
  } else if (setup.state === 'canUse' && setup.source) {
    const areas = await sendsWhat(setup.source.areas)
    const script = setup.source.areas.includes('traffic')
    step = (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 rounded-lg border border-brand/40 bg-brand/5 p-4">
          <p className="text-sm">
            {script || !areas
              ? t('canUseScript', { source: setup.source.name })
              : t('canUse', { source: setup.source.name, areas })}
          </p>
          <UseSource
            slug={product.slug}
            source={setup.source.id}
            label={t('use', { source: setup.source.name })}
          />
        </div>
        <p className="text-sm font-medium">{t('orNew')}</p>
        <ErrorsStart slug={product.slug} />
      </div>
    )
  } else {
    step = <ErrorsStart slug={product.slug} />
  }

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="errors-start-title"
        className="grid gap-8 rounded-2xl border border-border bg-card p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_24rem]"
      >
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex max-w-2xl flex-col gap-2">
            <span className="text-xs font-semibold tracking-wide text-brand uppercase">
              {t('eyebrow')}
            </span>
            <h1
              id="errors-start-title"
              className="font-display text-3xl leading-tight font-semibold"
            >
              {t('title')}
            </h1>
            <p className="text-muted-foreground">{t('body')}</p>
          </div>
          {setup.state === 'dismissed' && manager && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm">
              <span className="flex-1">{t('dismissed')}</span>
              <form action={restoreAreaAction}>
                <input type="hidden" name="slug" value={product.slug} />
                <input type="hidden" name="area" value="errors" />
                <Button type="submit" size="sm" variant="outline">
                  {t('restore')}
                </Button>
              </form>
            </div>
          )}
          {step}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <Link href={`${errorsPath}/setup`} className="text-brand underline underline-offset-4">
              {t('options')}
            </Link>
            {manager && setup.state !== 'dismissed' && setup.state !== 'waiting' && (
              <form action={dismissAreaAction}>
                <input type="hidden" name="slug" value={product.slug} />
                <input type="hidden" name="area" value="errors" />
                <button
                  type="submit"
                  className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  {t('wontUse')}
                </button>
              </form>
            )}
          </div>
        </div>
        <Example />
      </section>

      <section aria-label={t('featuresLabel')} className="grid gap-4 md:grid-cols-3">
        {features.map((feature, i) => {
          const Icon = icons[i] ?? LayersIcon
          return (
            <Card key={feature.title}>
              <CardContent className="flex gap-3">
                <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-brand" />
                <div className="flex flex-col gap-1">
                  <h2 className="text-sm font-semibold">{feature.title}</h2>
                  <p className="text-sm text-muted-foreground">{feature.body}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </section>
    </div>
  )
}

/** How many silent sources the warning names before "and N more". */
const SILENT_SHOWN = 5

/**
 * Configured, nothing in the period and nothing open: a zero said as such,
 * with the last error, a wider period and the resolved issues. Each source set
 * for Errors shows whether it sent anything at all in the period; one that
 * did not gets a warning, since its zero may be only silence.
 */
export async function ErrorsQuiet({
  orgId,
  setup,
  path,
  state,
  from,
  several,
  resolved,
}: {
  orgId: string
  setup: ProductSetup[]
  path: string
  state: ErrorsState
  /** Start of the period. */
  from: Date
  several: boolean
  resolved: number
}) {
  const [t, ts, format] = await Promise.all([
    getTranslations('errorsArea.quiet'),
    getTranslations('errorsArea.since'),
    getFormatter(),
  ])
  const latest = setup
    .filter((s) => s.last)
    .sort((a, b) => (b.last?.lastSeen.getTime() ?? 0) - (a.last?.lastSeen.getTime() ?? 0))[0]
  const wider = state.period === '7d' ? '30d' : state.period === '30d' ? null : '7d'
  const last = latest?.last

  const sources = setup.flatMap((s) =>
    s.errorSources.map((source) => ({ ...source, product: s.product })),
  )
  const month = new Date(Date.now() - 30 * 86_400_000)
  const seen =
    sources.length === 0
      ? null
      : await sourcesLastData(
          services().clickhouse,
          orgId,
          [...new Set(sources.map((s) => s.product.id))],
          from < month ? from : month,
        ).catch(() => null)
  const rows = sources.map((s) => {
    const at = seen?.get(s.id) ?? null
    return { ...s, at, sending: at !== null && at >= from }
  })
  const silent = seen ? rows.filter((r) => !r.sending) : []
  const label = (r: (typeof rows)[number]) => (several ? `${r.product.name} · ${r.name}` : r.name)
  const status = (r: (typeof rows)[number]) =>
    r.sending
      ? t('sending', { ago: format.relativeTime(r.at ?? new Date()) })
      : r.at
        ? t('silentSince', { ago: format.relativeTime(r.at) })
        : t('silentMonth')

  return (
    <>
      <section
        aria-labelledby="errors-quiet-title"
        className="grid gap-8 rounded-2xl border border-border bg-card p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_22rem]"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <span
            aria-hidden
            className="flex size-12 items-center justify-center rounded-xl bg-ok/15 text-ok"
          >
            <CheckIcon className="size-6" />
          </span>
          <h2 id="errors-quiet-title" className="font-display text-2xl font-semibold">
            {t('title', { period: ts(state.period) })}
          </h2>
          {seen && rows.length > 0 && silent.length === 0 && (
            <p className="text-muted-foreground">{t('real')}</p>
          )}
          {last && latest && (
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-muted-foreground">
              {several
                ? t('lastIn', {
                    ago: format.relativeTime(last.lastSeen),
                    product: latest.product.name,
                  })
                : t('last', { ago: format.relativeTime(last.lastSeen) })}
              <code className="font-mono text-xs break-words text-foreground">
                {issueTitle(last)}
              </code>
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {wider && (
              <Button asChild variant="outline">
                <Link href={errorsHref(path, state, { period: wider })}>{t(`wider.${wider}`)}</Link>
              </Button>
            )}
            {last && latest && (
              <Button asChild variant="outline">
                <Link href={`/p/${latest.product.slug}/errors/${last.id}`}>{t('openLast')}</Link>
              </Button>
            )}
            {resolved > 0 && (
              <Button asChild variant="outline">
                <Link href={errorsHref(path, state, { tab: 'resolved' })}>
                  {t('resolved', { count: resolved })}
                </Link>
              </Button>
            )}
          </div>
        </div>
        {seen && !several && rows.length > 0 && (
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="text-sm font-semibold">{t('sourcesTitle')}</h3>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  {r.sending ? (
                    <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-ok" />
                  ) : (
                    <CircleAlertIcon aria-hidden className="size-4 shrink-0 text-warn" />
                  )}
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium">{r.name}</span>
                    <span className="text-xs text-muted-foreground">{status(r)}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t('sendingNote')}</p>
          </div>
        )}
      </section>

      {silent.length > 0 && (
        <section
          aria-labelledby="errors-silent-title"
          className="flex gap-3 rounded-xl border border-warn/40 bg-warn/10 p-4 sm:p-5"
        >
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
          <div className="flex min-w-0 flex-col gap-2">
            <h2 id="errors-silent-title" className="text-sm font-semibold">
              {t('silentTitle', { count: silent.length })}
            </h2>
            <p className="text-sm">
              {t('silentBody', {
                count: silent.length,
                sources: format.list(silent.slice(0, SILENT_SHOWN).map(label), {
                  type: 'conjunction',
                }),
                period: ts(state.period),
              })}
              {silent.length > SILENT_SHOWN &&
                ` ${t('silentMore', { count: silent.length - SILENT_SHOWN })}`}
            </p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {silent.slice(0, SILENT_SHOWN).map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/p/${r.product.slug}/settings/sources/${r.id}`}
                    className="font-medium underline underline-offset-4"
                  >
                    {t('openSource', { source: label(r) })}
                  </Link>
                  <span className="text-muted-foreground"> · {status(r)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  )
}

/**
 * The products that do not send errors yet, each with its shortest next step,
 * quickest first. The whole page before any product sends; a folded line
 * at the end of the list after.
 */
export async function ErrorsProducts({
  setup,
  folded,
}: {
  setup: ProductSetup[]
  folded: boolean
}) {
  const [{ org }, t] = await Promise.all([requireOrg(), getTranslations('errorsArea.products')])
  const manager = canManage(org.role)
  const rows = setup.filter((s) => s.state !== 'sending')
  if (rows.length === 0) return null
  const what = new Map(
    await Promise.all(
      rows.map(async (s) => [s.product.id, await sendsWhat(s.source?.areas ?? [])] as const),
    ),
  )

  const table = (
    <Table>
      <caption className="sr-only">{t('caption')}</caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t('product')}</TableHead>
          <TableHead scope="col">{t('status')}</TableHead>
          <TableHead scope="col" className="hidden text-right sm:table-cell">
            <span className="sr-only">{t('action')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => {
          const href = `/p/${s.product.slug}/errors`
          const muted = s.state === 'dismissed'
          const source = s.source?.name ?? ''
          let status: React.ReactNode
          let action: React.ReactNode
          if (s.state === 'waiting') {
            status = (
              <span className="flex items-center gap-2">
                <span aria-hidden className="relative flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60 motion-reduce:animate-none" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-brand" />
                </span>
                {t('state.waiting')}
              </span>
            )
            action = (
              <Link href={href} className="font-medium text-brand underline underline-offset-4">
                {t('actions.waiting')}
              </Link>
            )
          } else if (s.state === 'canUse' && s.source) {
            const areas = what.get(s.product.id)
            status = areas ? t('state.canUse', { source, areas }) : t('state.canUseKey', { source })
            action = manager ? (
              <UseSource
                slug={s.product.slug}
                source={s.source.id}
                label={t('actions.canUse', { source })}
              />
            ) : null
          } else if (s.state === 'dismissed') {
            status = t('state.dismissed')
            action = manager ? (
              <Link href={href} className="text-muted-foreground underline underline-offset-4">
                {t('actions.dismissed')}
              </Link>
            ) : null
          } else {
            status = t('state.none')
            action = manager ? (
              <Button asChild size="sm" variant="outline">
                <Link href={href}>{t('actions.none')}</Link>
              </Button>
            ) : null
          }
          return (
            <TableRow key={s.product.id} className={muted ? 'text-muted-foreground' : undefined}>
              <TableHead scope="row" className="font-semibold">
                <Link href={href} className="hover:underline">
                  {s.product.name}
                </Link>
              </TableHead>
              <TableCell className="whitespace-normal text-muted-foreground">
                {status}
                {action && <div className="flex pt-2 sm:hidden">{action}</div>}
              </TableCell>
              <TableCell className="hidden text-right sm:table-cell">
                <div className="flex justify-end">{action}</div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )

  if (folded) {
    return (
      <details className="rounded-xl border border-border px-5 py-3 open:pb-5">
        <summary className="cursor-pointer text-sm font-medium">
          {t('more', { count: rows.length })}
        </summary>
        <div className="pt-4">{table}</div>
      </details>
    )
  }
  return (
    <section
      aria-labelledby="errors-products-title"
      className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 sm:p-8"
    >
      <div className="flex max-w-2xl flex-col gap-2">
        <span className="text-xs font-semibold tracking-wide text-brand uppercase">
          {(await getTranslations('errorsArea.start'))('eyebrow')}
        </span>
        <h2 id="errors-products-title" className="font-display text-2xl font-semibold">
          {t('title')}
        </h2>
        <p className="text-muted-foreground">{t('body')}</p>
      </div>
      {table}
    </section>
  )
}
