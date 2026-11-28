import { randomBytes } from 'node:crypto'
import {
  type ConnectionRule,
  getProjectBySlug,
  listConnectionProjects,
  listConnections,
  listProjects,
} from '@octadash/db'
import { MONEY_GATEWAYS, moneyGateway } from '@octadash/integrations'
import {
  ArrowLeftIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
  SirenIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { dismissAreaAction } from '@/actions/areas'
import { CopyField } from '@/components/copy-field'
import { type GatewayChoice, MoneyConnectForm } from '@/components/money-connect-form'
import {
  MoneyKeysForm,
  MoneyReuseForm,
  MoneyRuleForm,
  StopMoneyDialog,
} from '@/components/money-connection-forms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('moneySetup')
  return { title: t('title') }
}

/**
 * Connect a payment gateway, as closed in the Money canvas: the connections
 * this product uses with their state, the ones other products use (one
 * account, several products), and a new one.
 */
export default async function MoneySetupPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { org } = await requireOrg()
  const { db, env } = services()
  const project = await getProjectBySlug(db, org.id, slug)
  if (!project) notFound()
  const manager = canManage(org.role)
  const now = new Date()
  const [connections, links, projects, t, locale, format] = await Promise.all([
    listConnections(db, org.id),
    listConnectionProjects(db, org.id),
    listProjects(db, org.id),
    getTranslations('moneySetup'),
    getLocale(),
    getFormatter(),
  ])
  const names = new Map(projects.map((p) => [p.id, p.name]))
  const rows = connections.flatMap((c) => {
    const gateway = moneyGateway(c.integration)
    if (!gateway) return []
    const served = links.filter((l) => l.connectionId === c.id)
    return [
      {
        ...c,
        gateway: { id: gateway.id, name: gateway.name, hasProducts: gateway.hasProducts },
        rule: served.find((l) => l.projectId === project.id)?.rule ?? null,
        others: served.filter((l) => l.projectId !== project.id),
      },
    ]
  })
  const mine = rows.filter((r) => r.rule)
  const elsewhere = rows.filter((r) => !r.rule && r.others.length > 0)
  const gateways: GatewayChoice[] = MONEY_GATEWAYS.map((g) => ({
    id: g.id,
    name: g.name,
    keyPlaceholder: g.keyPlaceholder,
    keyHelp: locale === 'pt-BR' ? g.keyHelp['pt-BR'] : g.keyHelp.en,
    hasProducts: g.hasProducts,
  }))
  const hooksUrl = `${env.OCTADASH_URL.replace(/\/$/, '')}/hooks`
  const ago = (date: Date | null) => (date ? format.relativeTime(date, now) : '')
  const otherNames = (others: { projectId: string }[]) =>
    format.list(
      others.map((o) => names.get(o.projectId) ?? ''),
      { type: 'conjunction' },
    )

  const form = (
    <MoneyConnectForm
      slug={project.slug}
      product={project.name}
      gateways={gateways}
      token={randomBytes(16).toString('hex')}
      asaasToken={randomBytes(16).toString('hex')}
      hooksUrl={hooksUrl}
    />
  )

  return (
    <>
      <nav aria-label={t('trail')} className="text-sm text-muted-foreground">
        <Link href={`/p/${project.slug}/money`} className="text-brand underline underline-offset-4">
          {t('money')}
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
                    {c.name !== c.gateway.name && (
                      <Badge variant="secondary">{c.gateway.name}</Badge>
                    )}
                  </h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
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
                        <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-ok" />
                        {t('state.ok', { time: ago(c.synced_at) })}
                      </>
                    )}
                  </dd>
                  <dt className="text-muted-foreground">{t('state.webhook')}</dt>
                  <dd>
                    {c.webhook_at
                      ? t('state.webhookAt', { time: ago(c.webhook_at) })
                      : t('state.noWebhook')}
                  </dd>
                  <dt className="text-muted-foreground">{t('state.key')}</dt>
                  <dd className="font-mono text-xs">•••• {c.key_hint}</dd>
                  {c.others.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">{t('state.alsoServes')}</dt>
                      <dd>{otherNames(c.others)}</dd>
                    </>
                  )}
                </dl>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">{t('webhookUrl')}</span>
                  <CopyField
                    value={`${hooksUrl}/${c.gateway.id}/${c.webhook_token}`}
                    label={t('webhookUrl')}
                    copyLabel={t('copy')}
                    copiedLabel={t('copied')}
                  />
                </div>
                {manager && (
                  <>
                    <details className="rounded-lg border border-border px-4 py-2 open:pb-4">
                      <summary className="cursor-pointer text-sm font-medium">
                        {t('steps.rule', { product: project.name })}
                      </summary>
                      <div className="pt-3">
                        <MoneyRuleForm
                          slug={project.slug}
                          connectionId={c.id}
                          gateway={c.gateway}
                          product={project.name}
                          rule={c.rule as ConnectionRule}
                        />
                      </div>
                    </details>
                    <details className="rounded-lg border border-border px-4 py-2 open:pb-4">
                      <summary className="cursor-pointer text-sm font-medium">
                        {t('updateKeys')}
                      </summary>
                      <div className="pt-3">
                        <MoneyKeysForm
                          slug={project.slug}
                          connectionId={c.id}
                          gateway={c.gateway}
                        />
                      </div>
                    </details>
                    <div>
                      <StopMoneyDialog
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
                            {c.name === c.gateway.name ? c.name : `${c.gateway.name} · ${c.name}`}
                          </span>{' '}
                          <span className="text-muted-foreground">
                            {t('reuse.serves', { products: otherNames(c.others) })}
                          </span>
                        </summary>
                        <div className="pt-3">
                          <MoneyReuseForm
                            slug={project.slug}
                            connectionId={c.id}
                            gateway={c.gateway}
                            product={project.name}
                            initial={
                              c.others.some((o) => o.rule.mode === 'all')
                                ? c.gateway.hasProducts
                                  ? { mode: 'products', values: [] }
                                  : { mode: 'metadata', values: [] }
                                : undefined
                            }
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
                <input type="hidden" name="area" value="money" />
                <Button type="submit" variant="ghost" className="text-muted-foreground">
                  {t('wontUse')}
                </Button>
              </form>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="text-sm font-semibold">{t('side.sharedTitle')}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t('side.sharedBody')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <SirenIcon aria-hidden className="size-4 text-error" />
                  {t('side.emergencyTitle')}
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t('side.emergencyBody')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheckIcon aria-hidden className="size-4 text-ok" />
                  {t('side.keyTitle')}
                </h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{t('side.keyBody')}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
