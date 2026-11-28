import { getProjectBySlug, listSources, type Source } from '@octadash/db'
import type { LucideIcon } from 'lucide-react'
import { CheckIcon } from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { adoptSourceAction } from '@/actions/area-sources'
import { dismissAreaAction, restoreAreaAction } from '@/actions/areas'
import { AreaStartForm } from '@/components/area-start-form'
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
import type { AreaSetup, AreaSetupState } from '@/lib/area-setup'
import { SOURCE_AREA_PLATFORMS, type SourceArea } from '@/lib/source-areas'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

/**
 * The empty page of an area, as closed in the empty-state canvas: what the
 * area gives, the shortest next step for where the product stands, an
 * example of the page, and what comes with it. Built for the areas that
 * sources feed (Errors, Traffic, Product usage, Logs); the others reuse the
 * shell and the table of products.
 */

export interface ProductAreaSetup extends AreaSetup {
  product: { id: string; name: string; slug: string }
}

const AREA_ORDER = ['traffic', 'usage', 'logs', 'errors', 'money', 'costs', 'uptime']

/** "page views and events": what a source already sends, in the setup pages' words. */
export async function sendsWhat(areas: string[]) {
  const [t, format] = await Promise.all([getTranslations('errorsSetup'), getFormatter()])
  const names = AREA_ORDER.filter((a) => areas.includes(a) && t.has(`areaNames.${a}`)).map((a) =>
    t(`areaNames.${a}` as 'areaNames.traffic'),
  )
  return names.length > 0 ? format.list(names, { type: 'conjunction' }) : null
}

/** "Use {source}": the source's key starts feeding the area, and the page shows its code. */
export function UseSource({
  slug,
  area,
  source,
  label,
  variant = 'default',
}: {
  slug: string
  area: SourceArea
  source: string
  label: string
  variant?: 'default' | 'outline'
}) {
  return (
    <form action={adoptSourceAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="area" value={area} />
      <input type="hidden" name="source" value={source} />
      <Button type="submit" size="sm" variant={variant}>
        {label}
      </Button>
    </form>
  )
}

/** A dot that pulses while something is awaited; still when motion is reduced. */
export function WaitingDot() {
  return (
    <span aria-hidden className="relative flex size-2.5 shrink-0">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2.5 rounded-full bg-brand" />
    </span>
  )
}

/** The example beside the next step: made-up numbers, marked as an example. */
export async function AreaExample({ children }: { children: ReactNode }) {
  const t = await getTranslations('areaStart')
  return (
    <section
      aria-label={t('exampleLabel')}
      className="flex flex-col gap-4 self-start rounded-xl border border-dashed border-border bg-muted/30 p-5 lg:sticky lg:top-6"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('example')}</h2>
        <Badge variant="outline">{t('exampleBadge')}</Badge>
      </div>
      {children}
      <p className="text-xs text-muted-foreground">{t('exampleNote')}</p>
    </section>
  )
}

/** Three numbers of an example. */
export function ExampleTiles({
  tiles,
}: {
  tiles: { label: string; value: string; note: string }[]
}) {
  return (
    <dl className="grid grid-cols-3 gap-2">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-card p-3"
        >
          <dt className="truncate text-xs text-muted-foreground">{tile.label}</dt>
          <dd className="font-display text-base font-semibold whitespace-nowrap tabular-nums sm:text-xl">
            {tile.value}
          </dd>
          <dd className="text-xs text-muted-foreground">{tile.note}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The usual example of an area: three numbers and a short list. */
export async function SourceAreaExample({ area }: { area: string }) {
  const t = await getTranslations(`areaStart.areas.${area}` as 'areaStart.areas.traffic')
  const example = t.raw('example') as {
    tiles: { label: string; value: string; note: string }[]
    rowsTitle: string
    rows: { label: string; value: string }[]
  }
  return (
    <AreaExample>
      <ExampleTiles tiles={example.tiles} />
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-muted-foreground">{example.rowsTitle}</h3>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
          {example.rows.map((row) => (
            <li key={row.label} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate font-mono text-xs">{row.label}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{row.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </AreaExample>
  )
}

/** The page around the next step: what it gives, the step, the example and what comes with it. */
export async function AreaStartShell({
  area,
  slug,
  setup,
  manager,
  icons,
  step,
  example,
  optionsHref,
}: {
  area: string
  slug: string
  setup: { state: AreaSetupState }
  manager: boolean
  /** The full setup page; `/p/<slug>/<area>/setup` when left out. */
  optionsHref?: string
  /** One for each of the three features, in order. */
  icons: LucideIcon[]
  step: ReactNode
  example: ReactNode
}) {
  const [t, ta] = await Promise.all([
    getTranslations('areaStart'),
    getTranslations(`areaStart.areas.${area}` as 'areaStart.areas.errors'),
  ])
  const name = ta('name')
  const features = ta.raw('features') as { title: string; body: string }[]
  const areaPath = `/p/${slug}/${area}`
  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby={`${area}-start-title`}
        className="grid gap-8 rounded-2xl border border-border bg-card p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_24rem]"
      >
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex max-w-2xl flex-col gap-2">
            <span className="text-xs font-semibold tracking-wide text-brand uppercase">
              {ta('eyebrow')}
            </span>
            <h1
              id={`${area}-start-title`}
              className="font-display text-3xl leading-tight font-semibold"
            >
              {ta('title')}
            </h1>
            <p className="text-muted-foreground">{ta('body')}</p>
          </div>
          {setup.state === 'dismissed' && manager && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm">
              <span className="flex-1">{t('dismissed', { area: name })}</span>
              <form action={restoreAreaAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="area" value={area} />
                <Button type="submit" size="sm" variant="outline">
                  {t('restore', { area: name })}
                </Button>
              </form>
            </div>
          )}
          <div className="flex flex-col gap-4">
            <h2 className="sr-only">{t('nextStep')}</h2>
            {step}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <Link
              href={optionsHref ?? `${areaPath}/setup`}
              className="text-brand underline underline-offset-4"
            >
              {ta('options')}
            </Link>
            {manager && setup.state !== 'dismissed' && setup.state !== 'waiting' && (
              <form action={dismissAreaAction}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="area" value={area} />
                <button
                  type="submit"
                  className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  {t('wontUse', { area: name })}
                </button>
              </form>
            )}
          </div>
        </div>
        {example}
      </section>

      <section aria-label={t('featuresLabel')} className="grid gap-4 md:grid-cols-3">
        {features.map((feature, i) => {
          const Icon = icons[i] ?? CheckIcon
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

/**
 * The next step of a source area for one product, and what the shell needs:
 * the code and the live wait for the source set for the area (from
 * `waiting`), "Use {source}" for one that sends something else, or where the
 * code runs to make a new one.
 */
export async function sourceAreaStep({
  area,
  orgId,
  slug,
  setup,
  waiting,
}: {
  area: SourceArea
  orgId: string
  slug: string
  setup: AreaSetup
  waiting: (
    source: Source & { public_key: string },
    project: { id: string; ingest_id: unknown },
    manager: boolean,
  ) => ReactNode | Promise<ReactNode>
}) {
  const { db } = services()
  const [{ org }, t, ta, tp, project] = await Promise.all([
    requireOrg(),
    getTranslations('areaStart'),
    getTranslations(`areaStart.areas.${area}` as 'areaStart.areas.errors'),
    getTranslations('platforms'),
    getProjectBySlug(db, orgId, slug),
  ])
  const manager = canManage(org.role)
  const sources = project ? await listSources(db, orgId, project.id) : []
  const source = sources.find((s) => s.id === setup.source?.id)
  const what = ta('what')
  const notes = ta.raw('notes') as Record<string, string>
  const form = (
    <AreaStartForm
      slug={slug}
      area={area}
      legend={ta('where')}
      submit={t('showCode')}
      platforms={SOURCE_AREA_PLATFORMS[area].map((p) => ({
        id: p,
        label: tp(p),
        note: notes[p] ?? notes.default ?? '',
      }))}
    />
  )

  let step: ReactNode
  if (setup.state === 'waiting' && source?.public_key && project) {
    step = (
      <div className="flex flex-col gap-4">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckIcon aria-hidden className="size-4 text-ok" />
          {t('waiting', { source: source.name, what })}
        </p>
        {await waiting({ ...source, public_key: source.public_key }, project, manager)}
      </div>
    )
  } else if (!manager) {
    step = <p className="text-sm text-muted-foreground">{t('viewer', { area: ta('name') })}</p>
  } else if (setup.state === 'canUse' && setup.source) {
    const areas = await sendsWhat(setup.source.areas)
    const others = (setup.candidates ?? []).filter((s) => s.id !== setup.source?.id)
    const script =
      setup.source.areas.includes('traffic') && (ta.raw('canUseScript') as string) !== ''
    step = (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 rounded-lg border border-brand/40 bg-brand/5 p-4">
          <p className="text-sm">
            {script
              ? ta('canUseScript', { source: setup.source.name })
              : areas
                ? ta('canUse', { source: setup.source.name, areas })
                : t('products.canUseKey', { source: setup.source.name, what })}
          </p>
          <div>
            <UseSource
              slug={slug}
              area={area}
              source={setup.source.id}
              label={t('use', { source: setup.source.name })}
            />
          </div>
          {others.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-brand/20 pt-3">
              <p className="text-sm text-muted-foreground">{t('orOther')}</p>
              <div className="flex flex-wrap gap-2">
                {others.map((other) => (
                  <UseSource
                    key={other.id}
                    slug={slug}
                    area={area}
                    source={other.id}
                    label={t('use', { source: other.name })}
                    variant="outline"
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        <p className="text-sm font-medium">{t('orNew')}</p>
        {form}
      </div>
    )
  } else {
    step = form
  }
  return { step, manager }
}

/**
 * The products that do not send to an area yet, each with its shortest next
 * step, quickest first. The whole page before any product sends; a folded
 * line at the end of the page after.
 */
export async function AreaProducts({
  area,
  setup,
  folded,
}: {
  area: SourceArea
  setup: ProductAreaSetup[]
  folded: boolean
}) {
  const [{ org }, t, ta] = await Promise.all([
    requireOrg(),
    getTranslations('areaStart'),
    getTranslations(`areaStart.areas.${area}` as 'areaStart.areas.errors'),
  ])
  const manager = canManage(org.role)
  const rows = setup.filter((s) => s.state !== 'sending')
  if (rows.length === 0) return null
  const name = ta('name')
  const what = ta('what')
  const sends = new Map(
    await Promise.all(
      rows.map(async (s) => [s.product.id, await sendsWhat(s.source?.areas ?? [])] as const),
    ),
  )

  const products: ProductRow[] = rows.map((s) => {
    const href = `/p/${s.product.slug}/${area}`
    const source = s.source?.name ?? ''
    let status: ReactNode
    let action: ReactNode = null
    if (s.state === 'waiting') {
      status = (
        <span className="flex items-center gap-2">
          <WaitingDot />
          {ta('waitingStatus')}
        </span>
      )
      action = (
        <Link href={href} className="font-medium text-brand underline underline-offset-4">
          {ta('waitingAction')}
        </Link>
      )
    } else if (s.state === 'canUse' && s.source) {
      const areas = sends.get(s.product.id)
      status = areas
        ? t('products.canUse', { source, areas, what })
        : t('products.canUseKey', { source, what })
      if (manager) {
        action = (
          <UseSource
            slug={s.product.slug}
            area={area}
            source={s.source.id}
            label={t('products.actions.canUse', { source })}
          />
        )
      }
    } else if (s.state === 'dismissed') {
      status = t('products.dismissed', { area: name })
      if (manager) action = <DismissedLink href={href} label={t('products.actions.dismissed')} />
    } else {
      status = t('products.none')
      if (manager) action = <SetUpLink href={href} label={t('products.actions.none')} />
    }
    return {
      id: s.product.id,
      name: s.product.name,
      href,
      status,
      action,
      muted: s.state === 'dismissed',
    }
  })
  return <ProductsTable area={area} rows={products} folded={folded} />
}

/** "Change", for a product marked as not using the area. */
export function DismissedLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-muted-foreground underline underline-offset-4">
      {label}
    </Link>
  )
}

/** "Set up", for a product with nothing yet. */
export function SetUpLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild size="sm" variant="outline">
      <Link href={href}>{label}</Link>
    </Button>
  )
}

/** One product in the table of an area: where it stands and its next step. */
export interface ProductRow {
  id: string
  name: string
  href: string
  status: ReactNode
  action: ReactNode
  /** Marked as not using the area. */
  muted?: boolean
}

/**
 * The products of an area that still need a step. The whole page before any
 * product has data; a folded line at the end of the page after.
 */
export async function ProductsTable({
  area,
  rows,
  folded,
}: {
  area: string
  rows: ProductRow[]
  folded: boolean
}) {
  if (rows.length === 0) return null
  const [t, ta] = await Promise.all([
    getTranslations('areaStart'),
    getTranslations(`areaStart.areas.${area}` as 'areaStart.areas.errors'),
  ])
  const table = (
    <Table>
      <caption className="sr-only">{t('products.caption', { area: ta('name') })}</caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t('products.product')}</TableHead>
          <TableHead scope="col">{t('products.status')}</TableHead>
          <TableHead scope="col" className="hidden text-right sm:table-cell">
            <span className="sr-only">{t('products.action')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className={row.muted ? 'text-muted-foreground' : undefined}>
            <TableHead scope="row" className="font-semibold">
              <Link href={row.href} className="hover:underline">
                {row.name}
              </Link>
            </TableHead>
            <TableCell className="whitespace-normal text-muted-foreground">
              {row.status}
              {row.action && <div className="flex pt-2 sm:hidden">{row.action}</div>}
            </TableCell>
            <TableCell className="hidden text-right sm:table-cell">
              <div className="flex justify-end">{row.action}</div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )

  if (folded) {
    return (
      <details className="rounded-xl border border-border px-5 py-3 open:pb-5">
        <summary className="cursor-pointer text-sm font-medium">
          {ta('more', { count: rows.length })}
        </summary>
        <div className="pt-4">{table}</div>
      </details>
    )
  }
  return (
    <section
      aria-labelledby={`${area}-products-title`}
      className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 sm:p-8"
    >
      <div className="flex max-w-2xl flex-col gap-2">
        <span className="text-xs font-semibold tracking-wide text-brand uppercase">
          {ta('eyebrow')}
        </span>
        <h2 id={`${area}-products-title`} className="font-display text-2xl font-semibold">
          {ta('productsTitle')}
        </h2>
        <p className="text-muted-foreground">{ta('productsBody')}</p>
      </div>
      {table}
    </section>
  )
}

/** An area of several products before any has data: the title, then the table of products. */
export function AreaProductsPage({
  title,
  intro,
  children,
}: {
  title: string
  intro: string
  /** The table: `AreaProducts` or `ProductsTable`. */
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{intro}</p>
      </div>
      {children}
    </div>
  )
}
