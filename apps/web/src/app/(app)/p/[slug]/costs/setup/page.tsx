import {
  getOrganizationSettings,
  getProjectBySlug,
  listConnections,
  listCostBudgets,
  listCostShares,
  listFixedCosts,
  listProjects,
} from '@octadash/db'
import { type CostProvider, costProvider } from '@octadash/integrations'
import {
  ArrowLeftIcon,
  CircleCheckIcon,
  ClockIcon,
  LoaderCircleIcon,
  ReceiptIcon,
  SplitIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { dismissAreaAction } from '@/actions/areas'
import { CostConnectForm } from '@/components/cost-connect-form'
import {
  CostBudgetForm,
  CostKeyForm,
  CostReuseForm,
  CostShareForm,
  FixedCostForm,
  StopCostDialog,
} from '@/components/cost-connection-forms'
import type { Split } from '@/components/cost-share-fields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { digitsOf, formatMoney } from '@/lib/money'
import { costConnectProps, costTagLabel } from '@/server/connection-setup'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('costsSetup')
  return { title: t('title') }
}

/** Major units as typed back into a field: "1500", "49.9". */
const typed = (minor: number, currency: string) => String(minor / 10 ** digitsOf(currency))

/**
 * Connect a cost, as closed in the Costs canvas: the costs this product
 * takes part of, the ones other products use (one account or bill, several
 * products), a new one, and the product's monthly budget.
 */
export default async function CostsSetupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { org } = await requireOrg()
  const { db } = services()
  const project = await getProjectBySlug(db, org.id, slug)
  if (!project) notFound()
  const manager = canManage(org.role)
  const now = new Date()
  const [connections, shares, fixed, budgets, projects, settings, t, locale, format] =
    await Promise.all([
      listConnections(db, org.id),
      listCostShares(db, org.id),
      listFixedCosts(db, org.id),
      listCostBudgets(db, org.id),
      listProjects(db, org.id),
      getOrganizationSettings(db, org.id),
      getTranslations('costsSetup'),
      getLocale(),
      getFormatter(),
    ])
  const tagLabel = (p: CostProvider) => costTagLabel(p, locale)
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const rows = connections.flatMap((c) => {
    const provider = costProvider(c.integration)
    if (!provider && c.integration !== 'fixed') return []
    const served = shares.filter((s) => s.connectionId === c.id)
    return [
      {
        ...c,
        provider,
        tagName: provider ? tagLabel(provider) : null,
        bill: fixed.find((f) => f.connectionId === c.id) ?? null,
        share: served.find((s) => s.projectId === project.id) ?? null,
        others: served.filter((s) => s.projectId !== project.id),
      },
    ]
  })
  const mine = rows.filter((r) => r.share)
  const elsewhere = rows.filter((r) => !r.share && r.others.length > 0)
  const budget = budgets.find((b) => b.projectId === project.id)
  const ago = (date: Date | null) => (date ? format.relativeTime(date, now) : '')
  const otherNames = (others: { projectId: string }[]) =>
    format.list(
      others.map((o) => names.get(o.projectId) ?? ''),
      { type: 'conjunction' },
    )
  const billText = (bill: { amount: number; currency: string; every: 'month' | 'year' }) =>
    t(`bill.per.${bill.every}`, { amount: formatMoney(bill.amount, bill.currency, locale) })

  const form = <CostConnectForm {...(await costConnectProps(org.id, project.slug, project.name))} />

  return (
    <>
      <nav aria-label={t('trail')} className="text-sm text-muted-foreground">
        <Link href={`/p/${project.slug}/costs`} className="text-brand underline underline-offset-4">
          {t('costs')}
        </Link>{' '}
        / {project.name}
      </nav>
      <div className="flex max-w-2xl flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {mine.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle>
                  <h2 className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold">
                    {c.name}
                    {(!c.provider || c.name !== c.provider.name) && (
                      <Badge variant="secondary">{c.provider ? c.provider.name : t('fixed')}</Badge>
                    )}
                  </h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
                  {c.provider ? (
                    <>
                      <dt className="text-muted-foreground">{t('state.label')}</dt>
                      <dd className="flex min-w-0 items-start gap-1.5">
                        {c.status === 'failing' ? (
                          <>
                            <TriangleAlertIcon
                              aria-hidden
                              className="mt-0.5 size-4 shrink-0 text-error"
                            />
                            <span>
                              <span className="font-medium text-error">{t('state.failing')}</span>{' '}
                              <span className="wrap-anywhere text-muted-foreground">
                                {c.last_error}
                              </span>
                            </span>
                          </>
                        ) : c.status === 'importing' ? (
                          <>
                            <LoaderCircleIcon
                              aria-hidden
                              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            />
                            {t('state.importing')}
                          </>
                        ) : (
                          <>
                            <CircleCheckIcon
                              aria-hidden
                              className="mt-0.5 size-4 shrink-0 text-ok"
                            />
                            {t('state.ok', { time: ago(c.synced_at) })}
                          </>
                        )}
                      </dd>
                      <dt className="text-muted-foreground">{t('state.every')}</dt>
                      <dd>{t(c.provider.every <= 60 ? 'state.hourly' : 'state.daily')}</dd>
                      <dt className="text-muted-foreground">{t('state.key')}</dt>
                      <dd className="font-mono text-xs">•••• {c.key_hint}</dd>
                    </>
                  ) : (
                    c.bill && (
                      <>
                        <dt className="text-muted-foreground">{t('state.bill')}</dt>
                        <dd>{billText(c.bill)}</dd>
                      </>
                    )
                  )}
                  <dt className="text-muted-foreground">{t('state.part')}</dt>
                  <dd>
                    {c.share && c.share.tags.length > 0
                      ? t('state.tags', { count: c.share.tags.length, tag: c.tagName ?? '' })
                      : ''}
                    {c.share && c.share.tags.length > 0 && c.share.rest ? ' · ' : ''}
                    {c.share?.rest
                      ? c.split === 'percent' && c.share.percent === null
                        ? t('state.rest.percentNone')
                        : t(`state.rest.${c.split as Split}`, { percent: c.share.percent ?? 0 })
                      : ''}
                  </dd>
                  {c.others.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">{t('state.alsoServes')}</dt>
                      <dd>{otherNames(c.others)}</dd>
                    </>
                  )}
                </dl>
                {manager && (
                  <>
                    <details className="rounded-lg border border-border px-4 py-2 open:pb-4">
                      <summary className="cursor-pointer text-sm font-medium">
                        {t('steps.share', { product: project.name })}
                      </summary>
                      <div className="pt-3">
                        <CostShareForm
                          slug={project.slug}
                          connectionId={c.id}
                          product={project.name}
                          tagName={c.tagName}
                          split={c.split as Split}
                          others={c.others.length}
                          initial={c.share ?? undefined}
                        />
                      </div>
                    </details>
                    <details className="rounded-lg border border-border px-4 py-2 open:pb-4">
                      <summary className="cursor-pointer text-sm font-medium">
                        {c.provider ? t('updateKey') : t('changeBill')}
                      </summary>
                      <div className="pt-3">
                        {c.provider ? (
                          <CostKeyForm
                            slug={project.slug}
                            connectionId={c.id}
                            provider={c.provider.name}
                          />
                        ) : (
                          c.bill && (
                            <FixedCostForm
                              slug={project.slug}
                              connectionId={c.id}
                              bill={{
                                name: c.name,
                                amount: typed(c.bill.amount, c.bill.currency),
                                currency: c.bill.currency,
                                every: c.bill.every,
                                startsOn: c.bill.startsOn,
                              }}
                            />
                          )
                        )}
                      </div>
                    </details>
                    <div>
                      <StopCostDialog
                        slug={project.slug}
                        connectionId={c.id}
                        name={c.name}
                        last={c.others.length === 0}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}

          {manager && elsewhere.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2 className="font-display text-lg font-semibold">{t('reuse.title')}</h2>
                </CardTitle>
                <p className="text-sm text-muted-foreground">{t('reuse.body')}</p>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-3">
                  {elsewhere.map((c) => (
                    <li key={c.id}>
                      <details className="rounded-lg border border-border px-4 py-2 open:pb-4">
                        <summary className="cursor-pointer text-sm">
                          <span className="font-medium">
                            {c.provider && c.name !== c.provider.name
                              ? `${c.provider.name} · ${c.name}`
                              : c.name}
                          </span>{' '}
                          <span className="text-muted-foreground">
                            {c.bill ? `${billText(c.bill)} · ` : ''}
                            {t('reuse.serves', { products: otherNames(c.others) })}
                          </span>
                        </summary>
                        <div className="pt-3">
                          <CostReuseForm
                            slug={project.slug}
                            connectionId={c.id}
                            product={project.name}
                            tagName={c.tagName}
                            split={c.split as Split}
                            others={c.others.length}
                          />
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {manager &&
            (mine.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <h2 className="font-display text-lg font-semibold">
                      {elsewhere.length > 0 ? t('newTitle') : t('title')}
                    </h2>
                  </CardTitle>
                </CardHeader>
                <CardContent>{form}</CardContent>
              </Card>
            ) : (
              <details className="rounded-xl border border-border px-5 py-3 open:pb-5">
                <summary className="cursor-pointer text-sm font-medium">{t('addAnother')}</summary>
                <div className="pt-4">{form}</div>
              </details>
            ))}

          {manager && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2 className="font-display text-lg font-semibold">
                    {t('budget.title', { product: project.name })}
                  </h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CostBudgetForm
                  slug={project.slug}
                  currency={settings.currency}
                  amount={budget ? typed(budget.amount, settings.currency) : ''}
                  warn={budget?.warn ?? 80}
                />
              </CardContent>
            </Card>
          )}

          {!manager && mine.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('readOnly')}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/p/${project.slug}`}>
                <ArrowLeftIcon data-icon="inline-start" aria-hidden />
                {t('back', { name: project.name })}
              </Link>
            </Button>
            {manager && mine.length === 0 && (
              <form action={dismissAreaAction}>
                <input type="hidden" name="slug" value={project.slug} />
                <input type="hidden" name="area" value="costs" />
                <Button type="submit" variant="ghost" className="text-muted-foreground">
                  {t('wontUse')}
                </Button>
              </form>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {(
            [
              ['fixedTitle', 'fixedBody', ReceiptIcon],
              ['everyTitle', 'everyBody', ClockIcon],
              ['sharedTitle', 'sharedBody', SplitIcon],
            ] as const
          ).map(([title, body, Icon]) => (
            <Card key={title}>
              <CardHeader>
                <CardTitle>
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <Icon aria-hidden className="size-4 text-muted-foreground" />
                    {t(`side.${title}`)}
                  </h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t(`side.${body}`)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </>
  )
}
