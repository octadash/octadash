import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { switchOrgAction } from '@/actions/auth'
import { createOrgAction } from '@/actions/organization'
import { ActionForm } from '@/components/action-form'
import { Field } from '@/components/field'
import { SettingsCard, SettingsHeader } from '@/components/settings-page'
import { SubmitButton } from '@/components/submit-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { isOwner, requireOrg } from '@/server/session'

/**
 * Settings › Organizations (owners): the organizations you are part of in this
 * install, switching between them and starting a new one, with its own
 * products and members.
 */
export default async function OrganizationsPage() {
  const { org, orgs } = await requireOrg()
  if (!isOwner(org.role)) redirect('/settings/general')
  const [t, tMembers] = await Promise.all([
    getTranslations('settings.organizationsPage'),
    getTranslations('members'),
  ])
  const roleName = (role: string) =>
    isOwner(role)
      ? tMembers('roleOwner')
      : role.includes('admin')
        ? tMembers('roleAdmin')
        : tMembers('roleMember')
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SettingsHeader title={t('title')} intro={t('intro')} />
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        {orgs.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="font-medium">{o.name}</span>
            <Badge variant="secondary">{roleName(o.role)}</Badge>
            <span className="ml-auto">
              {o.id === org.id ? (
                <span className="text-sm text-muted-foreground">{t('current')}</span>
              ) : (
                <form action={switchOrgAction}>
                  <input type="hidden" name="organizationId" value={o.id} />
                  <Button type="submit" variant="outline" size="sm">
                    {t('open', { name: o.name })}
                  </Button>
                </form>
              )}
            </span>
          </li>
        ))}
      </ul>
      <SettingsCard title={t('newTitle')}>
        <p className="text-sm text-muted-foreground">{t('newBody')}</p>
        <ActionForm action={createOrgAction}>
          <Field label={t('name')}>
            <Input name="name" maxLength={80} required autoComplete="off" />
          </Field>
          <SubmitButton className="self-start">{t('create')}</SubmitButton>
        </ActionForm>
      </SettingsCard>
    </div>
  )
}
