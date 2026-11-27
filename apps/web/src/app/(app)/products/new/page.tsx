import { getTranslations } from 'next-intl/server'
import { createProjectAction } from '@/actions/projects'
import { ActionForm } from '@/components/action-form'
import { SubmitButton } from '@/components/submit-button'
import { Card, Field, Input } from '@/components/ui'

export default async function NewProductPage() {
  const t = await getTranslations('projects')
  return (
    <Card className="flex max-w-lg flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-xl font-semibold">{t('newTitle')}</h1>
        <p className="text-sm text-muted">{t('newIntro')}</p>
      </div>
      <ActionForm action={createProjectAction}>
        <Field label={t('name')}>
          <Input name="name" maxLength={80} required autoFocus />
        </Field>
        <Field label={t('url')} hint={t('urlHint')}>
          <Input name="url" inputMode="url" placeholder="example.com" maxLength={300} />
        </Field>
        <SubmitButton>{t('create')}</SubmitButton>
      </ActionForm>
    </Card>
  )
}
