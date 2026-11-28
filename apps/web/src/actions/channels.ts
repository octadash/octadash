'use server'

import { decryptSecret, encryptSecret } from '@octadash/core'
import { createChannel, deleteChannel, getChannel, updateChannel } from '@octadash/db'
import {
  builtinIntegrations,
  findTelegramChats,
  formFields,
  type NotificationIntegration,
  splitSecrets,
  type TelegramChat,
} from '@octadash/integrations'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

const LOCALES = ['en', 'pt-BR']

function notifier(id: string) {
  return builtinIntegrations.find(
    (i): i is NotificationIntegration => i.kind === 'notification' && i.id === id,
  )
}

/** Reads the integration's fields from the form. Blank secrets keep the saved ones. */
function readFields(
  integration: NotificationIntegration,
  formData: FormData,
  saved: Record<string, string>,
) {
  const values: Record<string, unknown> = {}
  for (const field of formFields(integration)) {
    const raw = formData.get(`field.${field.key}`)
    if (field.type === 'boolean') {
      values[field.key] = raw === 'on'
      continue
    }
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (text === '') {
      if (field.secret && saved[field.key]) values[field.key] = saved[field.key]
      continue
    }
    values[field.key] = field.type === 'number' ? Number(text) : text
  }
  // SMTP: port 465 is TLS from the first byte; 587 and the rest upgrade with STARTTLS.
  if (integration.id === 'smtp') values.secure = Number(values.port ?? 587) === 465
  return values
}

function recipients(config: Record<string, unknown>) {
  return String(config.to ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean).length
}

export async function saveChannelAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('channels.errors')
  const { org } = await requireManager()
  const { db, env } = services()
  const channelId = String(formData.get('channelId') ?? '')
  const current = channelId ? await getChannel(db, org.id, channelId) : undefined
  if (channelId && !current) return { error: t('notFound') }

  const integration = notifier(current?.integration ?? String(formData.get('integration') ?? ''))
  if (!integration) return { error: t('pickType') }
  const name = String(formData.get('name') ?? '').trim()
  if (!name || name.length > 80) return { error: t('name') }
  const locale = String(formData.get('locale') ?? '')
  if (!LOCALES.includes(locale)) return { error: t('checkFields') }

  const saved: Record<string, string> = {}
  for (const [key, value] of Object.entries((current?.secrets as Record<string, string>) ?? {})) {
    saved[key] = decryptSecret(value, env.OCTADASH_SECRET)
  }
  const parsed = integration.config.safeParse(readFields(integration, formData, saved))
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')))]
    const labels = await getTranslations(`channels.fields.${integration.id}`)
    return { error: t('fields', { fields: keys.map((key) => labels(key)).join(', ') }) }
  }

  // "Send test" tries the form as it is, before anything is saved.
  if (formData.get('intent') === 'test') {
    const tChannels = await getTranslations('channels')
    const result = await integration.test(parsed.data, {
      fetch,
      signal: AbortSignal.timeout(15_000),
    })
    if (!result.ok) return { notice: { ok: false, text: result.message ?? t('checkFields') } }
    const count = recipients(parsed.data as Record<string, unknown>)
    return {
      notice: {
        ok: true,
        text:
          integration.id === 'smtp' || integration.id === 'resend'
            ? tChannels('testEmailOk', { count })
            : tChannels('testOk'),
      },
    }
  }

  const { plain, secrets } = splitSecrets(integration, parsed.data as Record<string, unknown>)
  const encrypted = Object.fromEntries(
    Object.entries(secrets).map(([key, value]) => [key, encryptSecret(value, env.OCTADASH_SECRET)]),
  )
  const input = { name, locale, config: plain, secrets: encrypted, enabled: true }
  if (current) await updateChannel(db, org.id, current.id, input)
  else await createChannel(db, org.id, { ...input, integration: integration.id })
  revalidatePath('/settings/channels')
  return { done: true }
}

export async function deleteChannelAction(_: FormState, formData: FormData): Promise<FormState> {
  const { org } = await requireManager()
  await deleteChannel(services().db, org.id, String(formData.get('channelId') ?? ''))
  revalidatePath('/settings/channels')
  return { done: true }
}

export type TestState = { ok: boolean; message?: string } | undefined

/** Sends a test message through a saved channel and says what happened. */
export async function testChannelAction(_: TestState, formData: FormData): Promise<TestState> {
  const t = await getTranslations('channels.errors')
  const { org } = await requireManager()
  const { db, env } = services()
  const channel = await getChannel(db, org.id, String(formData.get('channelId') ?? ''))
  const integration = channel && notifier(channel.integration)
  if (!channel || !integration) return { ok: false, message: t('notFound') }
  const config: Record<string, unknown> = { ...(channel.config as Record<string, unknown>) }
  for (const [key, value] of Object.entries(channel.secrets as Record<string, string>)) {
    config[key] = decryptSecret(value, env.OCTADASH_SECRET)
  }
  const parsed = integration.config.safeParse(config)
  if (!parsed.success) return { ok: false, message: t('checkFields') }
  return integration.test(parsed.data, { fetch, signal: AbortSignal.timeout(15_000) })
}

export type FindChatsState =
  | { ok: true; chats: TelegramChat[] }
  | { ok: false; message: string }
  | undefined

/**
 * "Find it for me": the chats that wrote to the bot lately. Uses the token in
 * the form, or the saved one when editing and the field was left blank.
 */
export async function findTelegramChatsAction(
  botToken: string,
  channelId?: string,
): Promise<FindChatsState> {
  const t = await getTranslations('channels.find')
  const { org } = await requireManager()
  const { db, env } = services()
  let token = botToken.trim()
  if (!token && channelId) {
    const channel = await getChannel(db, org.id, channelId)
    const saved = (channel?.secrets as Record<string, string> | undefined)?.botToken
    if (saved) token = decryptSecret(saved, env.OCTADASH_SECRET)
  }
  if (!token) return { ok: false, message: t('noToken') }
  try {
    const found = await findTelegramChats(token, { fetch, signal: AbortSignal.timeout(10_000) })
    if (!found.ok) {
      return {
        ok: false,
        message:
          found.message === 'invalid-token'
            ? t('badToken')
            : t('failed', { reason: found.message }),
      }
    }
    if (found.chats.length === 0) return { ok: false, message: t('none') }
    return found
  } catch {
    return { ok: false, message: t('failed', { reason: 'network' }) }
  }
}
