import { getTranslations } from 'next-intl/server'
import { changePasswordAction, renameMeAction } from '@/actions/organization'
import { ActionForm } from '@/components/action-form'
import { Field } from '@/components/field'
import { SettingsCard, SettingsHeader } from '@/components/settings-page'
import { SubmitButton } from '@/components/submit-button'
import { Input } from '@/components/ui/input'
import { requireOrg } from '@/server/session'

/** Settings › Profile: your name, your email and your password. */
export default async function ProfilePage() {
  const { user } = await requireOrg()
  const t = await getTranslations('settings.profilePage')
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SettingsHeader title={t('title')} intro={t('intro')} />
      <SettingsCard title={t('aboutTitle')}>
        <ActionForm action={renameMeAction} doneMessage={t('saved')}>
          <Field label={t('name')} hint={t('nameHint')}>
            <Input name="name" defaultValue={user.name} autoComplete="name" required />
          </Field>
          <Field label={t('email')} hint={t('emailHint')}>
            <Input value={user.email} readOnly disabled />
          </Field>
          <SubmitButton className="self-start">{t('save')}</SubmitButton>
        </ActionForm>
      </SettingsCard>
      <SettingsCard title={t('passwordTitle')}>
        <ActionForm action={changePasswordAction} doneMessage={t('passwordChanged')}>
          <Field label={t('current')}>
            <Input name="current" type="password" autoComplete="current-password" required />
          </Field>
          <Field label={t('next')} hint={t('nextHint')}>
            <Input
              name="next"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
            />
          </Field>
          <SubmitButton className="self-start">{t('change')}</SubmitButton>
        </ActionForm>
      </SettingsCard>
    </div>
  )
}
