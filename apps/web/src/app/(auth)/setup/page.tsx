import { needsSetup } from '@octadash/auth'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { setupAction } from '@/actions/auth'
import { ActionForm } from '@/components/action-form'
import { Field } from '@/components/field'
import { SubmitButton } from '@/components/submit-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { services } from '@/server/context'

export default async function SetupPage() {
  if (!(await needsSetup(services().pool))) redirect('/sign-in')
  const t = await getTranslations('auth')
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="font-display text-xl font-semibold">{t('setupTitle')}</h1>
        </CardTitle>
        <CardDescription>{t('setupIntro')}</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm action={setupAction}>
          <Field label={t('name')}>
            <Input name="name" autoComplete="name" required />
          </Field>
          <Field label={t('email')}>
            <Input name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label={t('password')} hint={t('passwordHint')}>
            <Input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
            />
          </Field>
          <Field label={t('orgName')} hint={t('orgNameHint')}>
            <Input name="orgName" autoComplete="organization" required />
          </Field>
          <SubmitButton>{t('createAccount')}</SubmitButton>
        </ActionForm>
      </CardContent>
    </Card>
  )
}
