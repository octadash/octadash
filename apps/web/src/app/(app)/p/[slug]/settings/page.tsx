import { getProjectBySlug } from '@octadash/db'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { updateProjectAction } from '@/actions/projects'
import { ActionForm } from '@/components/action-form'
import { DeleteProductDialog } from '@/components/delete-product-dialog'
import { Field } from '@/components/field'
import { SubmitButton } from '@/components/submit-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'

export default async function ProductSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { org } = await requireOrg()
  const project = await getProjectBySlug(services().db, org.id, slug)
  if (!project) notFound()
  const t = await getTranslations()

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="font-display text-xl font-semibold">{t('projects.settingsTitle')}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={updateProjectAction}>
            <input type="hidden" name="projectId" value={project.id} />
            <Field label={t('projects.name')}>
              <Input name="name" defaultValue={project.name} maxLength={80} required />
            </Field>
            <Field label={t('projects.url')} hint={t('projects.urlHint')}>
              <Input name="url" defaultValue={project.url ?? ''} inputMode="url" maxLength={300} />
            </Field>
            <SubmitButton className="self-start">{t('common.save')}</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>

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
  )
}
