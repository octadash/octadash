import { needsSetup } from '@octadash/auth'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { setupAction } from '@/actions/auth'
import { ActionForm } from '@/components/action-form'
import { Field } from '@/components/field'
import { RegionFields } from '@/components/region-fields'
import { SubmitButton } from '@/components/submit-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { currencyChoices, timeZoneGroups } from '@/lib/region'
import { services } from '@/server/context'

/** Step 1 of the first run: whoever opens a new install first becomes its owner. */
export default async function SetupPage() {
  if (!(await needsSetup(services().pool))) redirect('/sign-in')
  const [t, locale] = await Promise.all([getTranslations('auth'), getLocale()])
  return (
    <Card>
      <CardHeader>
        <p className="text-sm text-muted-foreground">{t('step', { step: 1, total: 2 })}</p>
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
          <fieldset className="flex flex-col gap-4 border-t border-border pt-4">
            <legend className="pr-2 text-sm font-semibold">{t('orgSection')}</legend>
            <Field label={t('orgName')} hint={t('orgNameHint')}>
              <Input name="orgName" autoComplete="organization" required />
            </Field>
            <RegionFields
              currencies={currencyChoices(locale)}
              zones={timeZoneGroups(new Date())}
              labels={{ currency: t('currency'), timeZone: t('timeZone') }}
            />
            <p className="text-xs text-muted-foreground">{t('regionHint')}</p>
          </fieldset>
          <SubmitButton>{t('createAccount')}</SubmitButton>
        </ActionForm>
      </CardContent>
    </Card>
  )
}
