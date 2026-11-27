import { getProjectBySlug } from '@octadash/db'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { deleteProjectAction, updateProjectAction } from '@/actions/projects'
import { ActionForm } from '@/components/action-form'
import { SubmitButton } from '@/components/submit-button'
import { Card, Field, Input } from '@/components/ui'
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
      <Card className="flex flex-col gap-5">
        <h1 className="font-display text-xl font-semibold">{t('projects.settingsTitle')}</h1>
        <ActionForm action={updateProjectAction}>
          <input type="hidden" name="projectId" value={project.id} />
          <Field label={t('projects.name')}>
            <Input name="name" defaultValue={project.name} maxLength={80} required />
          </Field>
          <Field label={t('projects.url')} hint={t('projects.urlHint')}>
            <Input name="url" defaultValue={project.url ?? ''} inputMode="url" maxLength={300} />
          </Field>
          <SubmitButton>{t('common.save')}</SubmitButton>
        </ActionForm>
      </Card>

      <Card className="flex flex-col gap-4 border-error/40">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-lg font-semibold">{t('projects.dangerTitle')}</h2>
          <p className="text-sm text-muted">{t('projects.dangerBody')}</p>
        </div>
        <ActionForm action={deleteProjectAction}>
          <input type="hidden" name="projectId" value={project.id} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="confirm" className="accent-magenta-500" />
            {t('projects.confirmDelete', { name: project.name })}
          </label>
          <SubmitButton variant="danger">{t('projects.delete')}</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  )
}
