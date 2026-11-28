import {
  getProjectBySlug,
  listAreaDetails,
  listMonitors,
  listRuleOverrides,
  listSources,
} from '@octadash/db'
import { CircleDashedIcon, CircleIcon, CircleSlashIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { restoreAreaAction } from '@/actions/areas'
import { updateProjectAction } from '@/actions/projects'
import { ActionForm } from '@/components/action-form'
import { DeleteProductDialog } from '@/components/delete-product-dialog'
import { Field } from '@/components/field'
import { InfoTip } from '@/components/info-tip'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { AREA_ITEMS } from '@/lib/areas'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

/** Where "Set up" and "Manage" go for each area. */
function areaHref(slug: string, area: string, on: boolean) {
  if (area === 'traffic') return on ? `/p/${slug}/traffic` : `/p/${slug}/traffic/setup`
  if (area === 'errors') return on ? `/p/${slug}/errors` : `/p/${slug}/errors/setup`
  if (area === 'usage') return on ? `/p/${slug}/usage` : `/p/${slug}/usage/setup`
  if (area === 'logs') return on ? `/p/${slug}/logs` : `/p/${slug}/logs/setup`
  if (area === 'money') return on ? `/p/${slug}/money` : `/p/${slug}/money/setup`
  return `/p/${slug}/${area}`
}

/** Product settings › General: name and address, every area with its state, rules, delete. */
export default async function ProductSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { org } = await requireOrg()
  const { db } = services()
  const project = await getProjectBySlug(db, org.id, slug)
  if (!project) notFound()
  const manager = canManage(org.role)
  const [sources, monitors, areas, overrides, t, ta, tc, tp, format] = await Promise.all([
    listSources(db, org.id, project.id),
    listMonitors(db, org.id, project.id),
    listAreaDetails(db, org.id, project.id),
    listRuleOverrides(db, org.id),
    getTranslations('productSettings'),
    getTranslations('areas'),
    getTranslations('common'),
    getTranslations('projects'),
    getFormatter(),
  ])
  const changed = overrides.filter((o) => o.product.slug === project.slug).length

  const rows = AREA_ITEMS.map(({ id, icon }) => {
    const detail = areas.get(id)
    const feeding = sources.filter((s) => s.areas.includes(id))
    const dismissed = detail?.state === 'dismissed'
    const on =
      !dismissed &&
      (id === 'uptime' ? monitors.length > 0 : feeding.length > 0 || detail?.state === 'set_up')
    let body: string
    if (dismissed) body = t('areas.notUsed')
    else if (id === 'uptime' && monitors.length > 0)
      body = t('areas.monitors', { count: monitors.length })
    else if (feeding.length > 0)
      body = t('areas.sources', {
        count: feeding.length,
        names: format.list(
          feeding.map((s) => s.name),
          { type: 'conjunction' },
        ),
      })
    else body = t('areas.nothing')
    return { id, icon, on, dismissed, detail, body }
  })

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">{t('generalPage.title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('generalPage.intro', { name: project.name })}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="font-display text-lg font-semibold">{t('generalPage.product')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={updateProjectAction} doneMessage={t('generalPage.saved')}>
            <input type="hidden" name="projectId" value={project.id} />
            <input type="hidden" name="slug" value={project.slug} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('generalPage.name')} hint={t('generalPage.nameHint')}>
                <Input
                  name="name"
                  defaultValue={project.name}
                  maxLength={80}
                  required
                  disabled={!manager}
                />
              </Field>
              <Field label={t('generalPage.address')} hint={t('generalPage.addressHint')}>
                <Input value={`/p/${project.slug}`} readOnly className="font-mono text-xs" />
              </Field>
            </div>
            {manager && <SubmitButton className="self-start">{tc('save')}</SubmitButton>}
          </ActionForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="flex items-center gap-1 font-display text-lg font-semibold">
              {t('areas.title')}
              <InfoTip label={t('areas.infoLabel')} title={t('areas.title')}>
                {t('areas.info')}
              </InfoTip>
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((row) => {
              const Icon = row.icon
              const StateIcon = row.dismissed
                ? CircleSlashIcon
                : row.on
                  ? CircleIcon
                  : CircleDashedIcon
              const state = row.dismissed
                ? t('areas.state.notUsed')
                : row.on
                  ? t('areas.state.on')
                  : t('areas.state.notSetUp')
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
                >
                  <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-48 flex-1 flex-col gap-0.5">
                    <h3 className="text-sm font-medium">{ta(`${row.id}.name`)}</h3>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <StateIcon
                        aria-hidden
                        className={row.on ? 'size-2.5 fill-ok text-ok' : 'size-2.5'}
                      />
                      {row.body}
                    </p>
                    {row.dismissed && (row.detail?.discarded ?? 0) > 0 && (
                      <p className="flex items-start gap-1.5 text-xs text-warn">
                        <TriangleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0" />
                        {t('areas.discarded', {
                          count: row.detail?.discarded ?? 0,
                          time: row.detail?.discardedAt
                            ? format.relativeTime(row.detail.discardedAt)
                            : '',
                        })}
                      </p>
                    )}
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">{state}</span>
                    {row.dismissed ? (
                      manager && (
                        <form action={restoreAreaAction}>
                          <input type="hidden" name="slug" value={project.slug} />
                          <input type="hidden" name="area" value={row.id} />
                          <Button type="submit" size="sm" variant="outline">
                            {t('areas.useAgain')}
                          </Button>
                        </form>
                      )
                    ) : (
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={areaHref(project.slug, row.id, row.on)}
                          aria-label={`${row.on ? t('areas.manage') : t('areas.setUp')}: ${ta(`${row.id}.name`)}`}
                        >
                          {row.on ? t('areas.manage') : t('areas.setUp')}
                        </Link>
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <h2 className="text-sm font-semibold">{t('rulesCard.title')}</h2>
            <p className="text-sm text-muted-foreground">
              {changed > 0
                ? t('rulesCard.changed', { name: project.name, count: changed })
                : t('rulesCard.same', { name: project.name })}
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/p/${project.slug}/settings/rules`}>{t('rulesCard.open')}</Link>
          </Button>
        </CardContent>
      </Card>

      {manager && (
        <Card className="ring-destructive/40">
          <CardContent className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <h2 className="text-sm font-semibold text-destructive">{t('danger.title')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('danger.body', {
                  name: project.name,
                  sources: sources.length,
                  monitors: monitors.length,
                })}
              </p>
            </div>
            <DeleteProductDialog
              projectId={project.id}
              name={project.name}
              labels={{
                trigger: tp('delete'),
                title: tp('deleteDialogTitle', {
                  name: project.name,
                }),
                body: t('danger.dialogBody', { name: project.name }),
                typeName: t('danger.typeName', { name: project.name }),
                cancel: tc('cancel'),
                confirm: tp('delete'),
              }}
            />
          </CardContent>
        </Card>
      )}
    </>
  )
}
