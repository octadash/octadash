import { lastNotifications, listChannels } from '@octadash/db'
import {
  builtinIntegrations,
  formFields,
  type NotificationIntegration,
} from '@octadash/integrations'
import { PlusIcon } from 'lucide-react'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import {
  ChannelDialog,
  type ChannelDialogLabels,
  type ChannelType,
} from '@/components/channel-dialog'
import { DeleteChannelDialog } from '@/components/delete-channel-dialog'
import { StatusDot } from '@/components/status-dot'
import { TestChannelButton } from '@/components/test-channel-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

const notifiers = builtinIntegrations.filter(
  (i): i is NotificationIntegration => i.kind === 'notification',
)

export default async function ChannelsPage() {
  const { org } = await requireOrg()
  const { db } = services()
  const [channels, last, t, format, locale] = await Promise.all([
    listChannels(db, org.id),
    lastNotifications(db, org.id),
    getTranslations('channels'),
    getFormatter(),
    getLocale(),
  ])
  const manager = canManage(org.role)
  const uiLocale = locale === 'pt-BR' ? 'pt-BR' : 'en'

  const types: ChannelType[] = notifiers.map((integration) => ({
    id: integration.id,
    name: integration.name,
    description: integration.description[uiLocale],
    docsUrl: integration.docsUrl,
    fields: formFields(integration).map((field) => {
      const base = `fields.${integration.id}.${field.key}`
      return {
        ...field,
        label: t(base as never),
        hint: t.has(`${base}Hint` as never) ? t(`${base}Hint` as never) : undefined,
        placeholder: t.has(`${base}Placeholder` as never)
          ? t(`${base}Placeholder` as never)
          : undefined,
      }
    }),
  }))
  const typeName = new Map(types.map((type) => [type.id, type.name]))

  const labels = (editing: boolean): ChannelDialogLabels => ({
    title: editing ? t('editTitle') : t('addTitle'),
    intro: t('dialogIntro'),
    type: t('type'),
    name: t('name'),
    namePlaceholder: t('namePlaceholder'),
    locale: t('locale'),
    locales: [
      { value: 'pt-BR', label: 'Português' },
      { value: 'en', label: 'English' },
    ],
    secretSaved: t('secretSaved'),
    docs: t('docs'),
    cancel: t('cancel'),
    submit: editing ? t('save') : t('add'),
  })

  const addButton = (
    <ChannelDialog
      trigger={
        <Button>
          <PlusIcon />
          {t('add')}
        </Button>
      }
      types={types}
      values={{
        integration: types[0]?.id ?? '',
        name: '',
        locale: uiLocale,
        config: {},
        savedSecrets: [],
      }}
      labels={labels(false)}
    />
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        {manager && channels.length > 0 && addButton}
      </div>

      {channels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <p className="font-medium">{t('emptyTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('emptyBody')}</p>
            {manager && addButton}
          </CardContent>
        </Card>
      ) : (
        <Card className="gap-0 py-0">
          {channels.map((channel, index) => {
            const sent = last.get(channel.id)
            return (
              <div
                key={channel.id}
                className={
                  index > 0
                    ? 'flex flex-wrap items-center gap-3 border-t px-4 py-3'
                    : 'flex flex-wrap items-center gap-3 px-4 py-3'
                }
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="truncate font-medium">{channel.name}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {typeName.get(channel.integration) ?? channel.integration}
                    <span aria-hidden>·</span>
                    {channel.locale === 'pt-BR' ? 'Português' : 'English'}
                    {sent && (
                      <>
                        <span aria-hidden>·</span>
                        <StatusDot status={sent.ok ? 'up' : 'down'} />
                        <span title={sent.error ?? undefined} className="truncate">
                          {sent.ok
                            ? t('lastOk', { when: format.relativeTime(sent.sent_at) })
                            : t('lastFailed', {
                                when: format.relativeTime(sent.sent_at),
                                error: sent.error ?? '',
                              })}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                {manager && (
                  <div className="flex flex-wrap items-center gap-1">
                    <TestChannelButton
                      channelId={channel.id}
                      labels={{ trigger: t('test'), sending: t('testing'), ok: t('testOk') }}
                    />
                    <ChannelDialog
                      trigger={<Button variant="ghost">{t('edit')}</Button>}
                      types={types}
                      values={{
                        id: channel.id,
                        integration: channel.integration,
                        name: channel.name,
                        locale: channel.locale,
                        config: (channel.config as Record<string, unknown>) ?? {},
                        savedSecrets: Object.keys((channel.secrets as object) ?? {}),
                      }}
                      labels={labels(true)}
                    />
                    <DeleteChannelDialog
                      channelId={channel.id}
                      labels={{
                        trigger: t('delete'),
                        title: t('deleteTitle', { name: channel.name }),
                        body: t('deleteBody'),
                        cancel: t('cancel'),
                      }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}
