import { lastNotifications, listChannels, listRules } from '@octadash/db'
import {
  builtinIntegrations,
  formFields,
  type NotificationIntegration,
} from '@octadash/integrations'
import {
  CircleCheckIcon,
  MailIcon,
  MessageCircleIcon,
  PlusIcon,
  SendIcon,
  TriangleAlertIcon,
  WebhookIcon,
} from 'lucide-react'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import {
  ChannelDialog,
  type ChannelDialogLabels,
  type ChannelType,
} from '@/components/channel-dialog'
import { DeleteChannelDialog } from '@/components/delete-channel-dialog'
import { InfoTip } from '@/components/info-tip'
import { SettingsHeader } from '@/components/settings-page'
import { TestChannelButton } from '@/components/test-channel-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { services } from '@/server/context'
import { inviteChannelOf } from '@/server/invitations'
import { canManage, requireOrg } from '@/server/session'

const notifiers = builtinIntegrations.filter(
  (i): i is NotificationIntegration => i.kind === 'notification',
)

const KIND_OF: Record<string, 'email' | 'telegram' | 'webhook'> = {
  smtp: 'email',
  resend: 'email',
  telegram: 'telegram',
  webhook: 'webhook',
}

const ICON = {
  email: MailIcon,
  telegram: SendIcon,
  webhook: WebhookIcon,
}

/** Settings › Channels: where emergencies go, with each channel's last result. */
export default async function ChannelsPage() {
  const { org } = await requireOrg()
  const { db } = services()
  const [channels, last, rules, t, format, locale] = await Promise.all([
    listChannels(db, org.id),
    lastNotifications(db, org.id),
    listRules(db, org.id, null),
    getTranslations('channels'),
    getFormatter(),
    getLocale(),
  ])
  const manager = canManage(org.role)
  const uiLocale = locale === 'pt-BR' ? 'pt-BR' : 'en'
  const sending = rules.filter((rule) => rule.level === 'emergency').length

  const types: ChannelType[] = notifiers.map((integration) => ({
    id: integration.id,
    name: integration.name,
    description: integration.description[uiLocale],
    docsUrl: integration.docsUrl,
    fields: formFields(integration).map((field) => {
      const base = `fields.${integration.id}.${field.key}`
      const has = (key: string) => t.has(key as never)
      return {
        ...field,
        label: t(base as never),
        hint: has(`${base}Hint`) ? t(`${base}Hint` as never) : undefined,
        placeholder: has(`${base}Placeholder`) ? t(`${base}Placeholder` as never) : undefined,
        info: has(`${base}Info`)
          ? {
              title: t(`${base}InfoTitle` as never),
              body: t(`${base}Info` as never),
              label: t('about', { field: t(base as never) }),
            }
          : undefined,
      }
    }),
  }))

  const labels = (editing: boolean): ChannelDialogLabels => ({
    title: editing ? t('editTitle') : t('addTitle'),
    intro: t('dialogIntro'),
    type: t('type'),
    kinds: {
      email: t('kinds.email'),
      telegram: t('kinds.telegram'),
      webhook: t('kinds.webhook'),
      whatsapp: t('kinds.whatsapp'),
    },
    later: t('later'),
    sendThrough: t('sendThrough'),
    name: t('name'),
    namePlaceholder: {
      email: t('namePlaceholders.email'),
      telegram: t('namePlaceholders.telegram'),
      webhook: t('namePlaceholders.webhook'),
    },
    locale: t('locale'),
    locales: [
      { value: 'en', label: 'English' },
      { value: 'pt-BR', label: 'Português' },
    ],
    secretSaved: t('secretSaved'),
    docs: t('docs'),
    cancel: t('cancel'),
    test: t('sendTest'),
    submit: editing ? t('save') : t('add'),
    find: {
      trigger: t('find.trigger'),
      searching: t('find.searching'),
      pick: t('find.pick'),
      topic: t('find.topic'),
      kinds: {
        private: t('find.kinds.private'),
        group: t('find.kinds.group'),
        channel: t('find.kinds.channel'),
      },
    },
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
      values={{ integration: 'smtp', name: '', locale: uiLocale, config: {}, savedSecrets: [] }}
      labels={labels(false)}
    />
  )

  /** Where a channel sends, in a line: addresses, chat or URL. */
  const target = (integration: string, config: Record<string, unknown>) => {
    switch (integration) {
      case 'smtp':
        return t('target.smtp', { to: String(config.to ?? ''), host: String(config.host ?? '') })
      case 'resend':
        return t('target.resend', { to: String(config.to ?? '') })
      case 'telegram':
        return config.threadId
          ? t('target.telegramTopic', {
              chat: String(config.chatId ?? ''),
              topic: String(config.threadId),
            })
          : t('target.telegram', { chat: String(config.chatId ?? '') })
      default:
        return String(config.url ?? '')
    }
  }

  const mailer = inviteChannelOf(channels)
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SettingsHeader
        title={t('title')}
        intro={t('intro')}
        action={manager && channels.length > 0 ? addButton : undefined}
      />

      {channels.length === 0 ? (
        <Empty className="border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SendIcon />
            </EmptyMedia>
            <EmptyTitle>
              <h2>{t('emptyTitle')}</h2>
            </EmptyTitle>
            <EmptyDescription>{t('emptyBody')}</EmptyDescription>
          </EmptyHeader>
          {manager && <EmptyContent>{addButton}</EmptyContent>}
        </Empty>
      ) : (
        <section
          aria-labelledby="channels-count"
          className="flex flex-col rounded-xl border border-border bg-card"
        >
          <h2
            id="channels-count"
            className="flex items-center gap-1 border-b border-border px-4 py-3 text-sm"
          >
            <span className="font-semibold">{t('count', { count: channels.length })}</span>
            <span className="text-muted-foreground">· {t('usedBy', { count: sending })}</span>
            <InfoTip label={t('rulesInfoLabel')} title={t('rulesInfoTitle')}>
              {t('rulesInfo')}
            </InfoTip>
          </h2>
          <ul className="divide-y divide-border">
            {channels.map((channel) => {
              const sent = last.get(channel.id)
              const kind = KIND_OF[channel.integration] ?? 'webhook'
              const Icon = ICON[kind]
              const config = (channel.config as Record<string, unknown>) ?? {}
              const signed = Boolean((channel.secrets as Record<string, string>)?.secret)
              return (
                <li key={channel.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 flex size-8 items-center justify-center rounded-lg bg-secondary">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{channel.name}</span>
                      <Badge variant="secondary">{t(`kinds.${kind}`)}</Badge>
                      <Badge variant="outline">
                        {channel.locale === 'pt-BR' ? 'Português' : 'English'}
                      </Badge>
                      {channel.id === mailer?.id && (
                        <Badge variant="outline">{t('sendsInvites')}</Badge>
                      )}
                    </p>
                    <p className="truncate text-sm text-muted-foreground">
                      {target(channel.integration, config)}
                      {kind === 'webhook' && signed && ` · ${t('signed')}`}
                    </p>
                    {sent ? (
                      <p className="flex items-center gap-1.5 text-xs">
                        {sent.ok ? (
                          <CircleCheckIcon className="size-3.5 text-ok" aria-hidden />
                        ) : (
                          <TriangleAlertIcon className="size-3.5 text-error" aria-hidden />
                        )}
                        <span className={sent.ok ? 'text-muted-foreground' : 'text-error'}>
                          {sent.ok
                            ? t('lastOk', { when: format.relativeTime(sent.sent_at) })
                            : t('lastFailed', {
                                when: format.relativeTime(sent.sent_at),
                                error: sent.error ?? '',
                              })}
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t('neverSent')}</p>
                    )}
                  </div>
                  {manager && (
                    <div className="flex flex-wrap items-center gap-1">
                      <TestChannelButton
                        channelId={channel.id}
                        labels={{ trigger: t('sendTest'), sending: t('testing'), ok: t('testOk') }}
                      />
                      <ChannelDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t('editLabel', { name: channel.name })}
                          >
                            {t('edit')}
                          </Button>
                        }
                        types={types}
                        values={{
                          id: channel.id,
                          integration: channel.integration,
                          name: channel.name,
                          locale: channel.locale,
                          config,
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
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section
        aria-labelledby="whatsapp-title"
        className="flex flex-col gap-1 rounded-xl border border-dashed border-border p-4 text-sm"
      >
        <h2 id="whatsapp-title" className="flex items-center gap-2 font-medium">
          <MessageCircleIcon className="size-4" aria-hidden />
          WhatsApp
          <Badge variant="secondary">{t('later')}</Badge>
        </h2>
        <p className="text-muted-foreground">{t('whatsapp')}</p>
      </section>
    </div>
  )
}
