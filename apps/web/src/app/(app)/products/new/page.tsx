import { getTranslations } from 'next-intl/server'
import { createProjectAction } from '@/actions/projects'
import { ActionForm } from '@/components/action-form'
import { Field } from '@/components/field'
import { SubmitButton } from '@/components/submit-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default async function NewProductPage() {
  const t = await getTranslations('projects')
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>
          <h1 className="font-display text-xl font-semibold">{t('newTitle')}</h1>
        </CardTitle>
        <CardDescription>{t('newIntro')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={createProjectAction}>
          <Field label={t('name')}>
            <Input name="name" maxLength={80} required autoFocus />
          </Field>
          <Field label={t('url')} hint={t('urlHint')}>
            <Input name="url" inputMode="url" placeholder="example.com" maxLength={300} />
          </Field>
          <SubmitButton className="self-start">{t('create')}</SubmitButton>
        </ActionForm>
      </CardContent>
    </Card>
  )
}
