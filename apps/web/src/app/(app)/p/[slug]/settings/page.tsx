import { getProjectBySlug, listProjectKeys, sentryDsn } from '@octadash/db'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { updateProjectAction } from '@/actions/projects'
import { ActionForm } from '@/components/action-form'
import { CopyField } from '@/components/copy-field'
import { DeleteProductDialog } from '@/components/delete-product-dialog'
import { Field } from '@/components/field'
import { RulesList } from '@/components/rules-list'
import { SubmitButton } from '@/components/submit-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

export default async function ProductSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { org } = await requireOrg()
  const { db, env } = services()
  const project = await getProjectBySlug(db, org.id, slug)
  if (!project) notFound()
  const [keys, t] = await Promise.all([listProjectKeys(db, org.id, project.id), getTranslations()])
  const key = keys.find((k) => !k.revoked_at)

  return (
    <>
      <h1 className="font-display text-3xl font-semibold">{project.name}</h1>
      <div className="flex max-w-2xl flex-col gap-6">
        {key && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="font-display text-lg font-semibold">{t('projects.keysTitle')}</h2>
              </CardTitle>
              <CardDescription>{t('projects.keysIntro')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <KeyRow label={t('projects.publicKey')} value={key.public_key} t={t} />
              <KeyRow
                label={t('projects.sentryDsn')}
                value={sentryDsn(
                  env.OCTADASH_INGEST_URL,
                  key.public_key,
                  String(project.ingest_id),
                )}
                t={t}
              />
              <KeyRow label={t('projects.ingestUrl')} value={env.OCTADASH_INGEST_URL} t={t} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="font-display text-lg font-semibold">{t('projects.settingsTitle')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ActionForm action={updateProjectAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <Field label={t('projects.name')}>
                <Input name="name" defaultValue={project.name} maxLength={80} required />
              </Field>
              <SubmitButton className="self-start">{t('common.save')}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-lg font-semibold">{t('alerts.productTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('alerts.productIntro')}</p>
          </div>
          <RulesList
            orgId={org.id}
            project={{ id: project.id, slug: project.slug }}
            canEdit={canManage(org.role)}
          />
        </section>

        <Card className="ring-destructive/40">
          <CardHeader>
            <CardTitle>
              <h2 className="font-display text-lg font-semibold">{t('projects.dangerTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('projects.dangerBody')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col">
            <DeleteProductDialog
              projectId={project.id}
              labels={{
                trigger: t('projects.delete'),
                title: t('projects.deleteDialogTitle', { name: project.name }),
                body: t('projects.dangerBody'),
                cancel: t('common.cancel'),
                confirm: t('projects.delete'),
              }}
            />
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function KeyRow({
  label,
  value,
  t,
}: {
  label: string
  value: string
  t: (key: 'common.copy' | 'common.copied') => string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <CopyField value={value} copyLabel={t('common.copy')} copiedLabel={t('common.copied')} />
    </div>
  )
}
