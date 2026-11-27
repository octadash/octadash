import { needsSetup } from '@octadash/auth'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { setupAction } from '@/actions/auth'
import { ActionForm } from '@/components/action-form'
import { SubmitButton } from '@/components/submit-button'
import { Card, Field, Input } from '@/components/ui'
import { services } from '@/server/context'

export default async function SetupPage() {
  if (!(await needsSetup(services().pool))) redirect('/sign-in')
  const t = await getTranslations('auth')
  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-xl font-semibold">{t('setupTitle')}</h1>
        <p className="text-sm text-muted">{t('setupIntro')}</p>
      </div>
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
    </Card>
  )
}
