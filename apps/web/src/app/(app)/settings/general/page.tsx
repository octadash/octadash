import { getOrganizationSettings, listProjects } from '@octadash/db'
import { getLocale, getTranslations } from 'next-intl/server'
import { renameOrgAction, saveRegionAction } from '@/actions/organization'
import { ActionForm } from '@/components/action-form'
import { DeleteOrgDialog } from '@/components/delete-org-dialog'
import { Field } from '@/components/field'
import { InfoTip } from '@/components/info-tip'
import { RegionFields } from '@/components/region-fields'
import { SettingsCard, SettingsHeader } from '@/components/settings-page'
import { SubmitButton } from '@/components/submit-button'
import { Input } from '@/components/ui/input'
import { currencyChoices, timeZoneGroups } from '@/lib/region'
import { services } from '@/server/context'
import { canManage, isOwner, requireOrg } from '@/server/session'

/** Settings › General: the organization's name, its money and time, and deleting it. */
export default async function GeneralPage() {
  const { org } = await requireOrg()
  const { db } = services()
  const [t, tCommon, locale, settings, products] = await Promise.all([
    getTranslations('settings.generalPage'),
    getTranslations('common'),
    getLocale(),
    getOrganizationSettings(db, org.id),
    listProjects(db, org.id),
  ])
  const manager = canManage(org.role)
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SettingsHeader title={t('title')} intro={t('intro')} />

      <SettingsCard title={t('nameTitle')}>
        <ActionForm action={renameOrgAction} doneMessage={t('saved')}>
          <Field label={t('name')} hint={t('nameHint')}>
            <Input
              name="name"
              defaultValue={org.name}
              maxLength={80}
              required
              disabled={!manager}
              autoComplete="organization"
            />
          </Field>
          {manager && <SubmitButton className="self-start">{t('save')}</SubmitButton>}
        </ActionForm>
      </SettingsCard>

      <SettingsCard
        title={t('regionTitle')}
        info={
          <InfoTip label={t('regionInfoLabel')} title={t('regionTitle')}>
            {t('regionInfo')}
          </InfoTip>
        }
      >
        <ActionForm action={saveRegionAction} doneMessage={t('saved')}>
          <fieldset disabled={!manager} className="contents">
            <RegionFields
              currencies={currencyChoices(locale)}
              zones={timeZoneGroups(new Date())}
              labels={{ currency: t('currency'), timeZone: t('timeZone') }}
              hints={{ currency: t('currencyHint'), timeZone: t('timeZoneHint') }}
              initial={settings}
            />
          </fieldset>
          {manager && <SubmitButton className="self-start">{t('save')}</SubmitButton>}
        </ActionForm>
      </SettingsCard>

      {isOwner(org.role) && (
        <SettingsCard title={t('dangerTitle')} tone="danger">
          <p className="text-sm">{t('dangerBody', { name: org.name, count: products.length })}</p>
          <DeleteOrgDialog
            name={org.name}
            labels={{
              trigger: t('delete'),
              title: t('deleteTitle', { name: org.name }),
              body: t('dangerBody', { name: org.name, count: products.length }),
              type: t('typeName', { name: org.name }),
              cancel: tCommon('cancel'),
              confirm: t('delete'),
            }}
          />
          <p className="text-xs text-muted-foreground">{t('ownersOnly')}</p>
        </SettingsCard>
      )}
    </div>
  )
}
