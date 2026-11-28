import { getTranslations } from 'next-intl/server'
import { createProjectAction } from '@/actions/projects'
import { ActionForm } from '@/components/action-form'
import { Field } from '@/components/field'
import { SubmitButton } from '@/components/submit-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

export default async function NewProductPage() {
  const t = await getTranslations()
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>
          <h1 className="font-display text-xl font-semibold">{t('newProduct.title')}</h1>
        </CardTitle>
        <CardDescription>{t('newProduct.intro')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={createProjectAction}>
          <Field label={t('projects.name')}>
            <Input
              name="name"
              maxLength={80}
              required
              autoFocus
              placeholder={t('newProduct.placeholder')}
            />
          </Field>
          <SubmitButton className="self-start">{t('projects.create')}</SubmitButton>
        </ActionForm>
      </CardContent>
    </Card>
  )
}
