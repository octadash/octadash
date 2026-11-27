import { needsSetup } from '@octadash/auth'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { signInAction } from '@/actions/auth'
import { ActionForm } from '@/components/action-form'
import { Field } from '@/components/field'
import { SubmitButton } from '@/components/submit-button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { services } from '@/server/context'
import { getViewer } from '@/server/session'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  if (await needsSetup(services().pool)) redirect('/setup')
  if (await getViewer()) redirect('/all')
  const t = await getTranslations('auth')
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="font-display text-xl font-semibold">{t('signInTitle')}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ActionForm action={signInAction}>
          {next && <input type="hidden" name="next" value={next} />}
          <Field label={t('email')}>
            <Input name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label={t('password')}>
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
          <SubmitButton>{t('signIn')}</SubmitButton>
        </ActionForm>
      </CardContent>
    </Card>
  )
}
