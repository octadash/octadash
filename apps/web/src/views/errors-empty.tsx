import { hasPageScript, sentryDsn, sourcesLastData } from '@octadash/db'
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
import { ErrorsInstall } from '@/components/errors-install'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { canFeed } from '@/lib/area-setup'
import { type ErrorsState, errorsHref, issueTitle } from '@/lib/errors'
import { isErrorPlatform } from '@/lib/errors-setup'
import { services } from '@/server/context'
import type { ProductSetup } from '@/server/errors'
import { AreaExample, AreaStartShell, ExampleTiles, sourceAreaStep } from './area-start'

/** How the Errors page will look once errors arrive: made-up numbers, marked as an example. */
async function ErrorsExample() {
  const t = await getTranslations('areaStart.areas.errors')
  const issues = t.raw('exampleIssues') as { badge: string; title: string; meta: string }[]
  return (
    <AreaExample>
      <ExampleTiles
        tiles={t.raw('exampleTiles') as { label: string; value: string; note: string }[]}
      />
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
          <span key={line} className={i === 1 ? '-mx-1 rounded bg-error/10 px-1' : undefined}>
            {line}
          </span>
        ))}
      </div>
    </AreaExample>
  )
}

/**
 * Errors of one product before the first error: where the code runs, a
 * source it already has, or the code and a live wait for the one set up,
 * beside an example of the page.
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
  const ingest = services().env.OCTADASH_INGEST_URL
  const errorsPath = `/p/${product.slug}/errors`
  const { step, manager } = await sourceAreaStep({
    area: 'errors',
    orgId,
    slug: product.slug,
    setup,
    waiting: (source, project) => (
      <ErrorsInstall
        key={source.id}
        sourceId={source.id}
        ingestUrl={ingest}
        publicKey={source.public_key}
        dsn={sentryDsn(ingest, source.public_key, String(project.ingest_id))}
        platform={isErrorPlatform(source.platform) ? source.platform : 'other'}
        issueHref={errorsPath}
        errorsHref={errorsPath}
        scriptOn={hasPageScript(source.platform, source.areas)}
        sourceName={source.name}
        addServerHref={
          canFeed('logs', source.platform)
            ? undefined
            : `/p/${product.slug}/errors/setup?add=server`
        }
      />
    ),
  })
  return (
    <AreaStartShell
      area="errors"
      slug={product.slug}
      setup={setup}
      manager={manager}
      icons={[LayersIcon, BellRingIcon, ShieldCheckIcon]}
      step={step}
      example={<ErrorsExample />}
    />
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
    const at = seen?.get(s.id)?.any ?? null
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
