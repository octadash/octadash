import { z } from 'zod'
import { defineNotification } from '../define'
import type { AlertMessage, AlertSeverity } from '../types'

const config = z.object({
  botToken: z.string().regex(/^\d+:[\w-]+$/, 'Bot token from @BotFather, e.g. 123456:ABC-DEF'),
  chatId: z.string().min(1),
  /** Topic id for group chats with topics enabled. */
  threadId: z.string().optional(),
})

const icon: Record<AlertSeverity, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  critical: '🔴',
  resolved: '✅',
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function telegramText(message: AlertMessage): string {
  const lines = [`${icon[message.severity]} <b>${escapeHtml(message.title)}</b>`]
  if (message.project) lines.push(escapeHtml(message.project.name))
  lines.push('', escapeHtml(message.body))
  if (message.url) lines.push('', message.url)
  return lines.join('\n')
}

async function callTelegram(
  cfg: z.infer<typeof config>,
  text: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
) {
  const response = await fetchFn(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: cfg.chatId,
      message_thread_id: cfg.threadId ? Number(cfg.threadId) : undefined,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    }),
    signal,
  })
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { description?: string } | null
    throw new Error(detail?.description ?? `Telegram answered ${response.status}`)
  }
}

export const telegram = defineNotification({
  id: 'telegram',
  kind: 'notification',
  name: 'Telegram',
  description: {
    en: 'Sends alerts to a Telegram chat, group or channel through your bot.',
    'pt-BR': 'Envia alertas para um chat, grupo ou canal do Telegram pelo seu bot.',
  },
  docsUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
  config,
  secretKeys: ['botToken'],
  async test(cfg, ctx) {
    try {
      await callTelegram(cfg, 'Octadash: test message', ctx.fetch, ctx.signal)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  },
  async send(message, cfg, ctx) {
    await callTelegram(cfg, telegramText(message), ctx.fetch, ctx.signal)
  },
})

export interface TelegramChat {
  id: string
  title: string
  kind: 'private' | 'group' | 'channel'
  /** Topic of a group with topics, when the message came from one. */
  threadId?: string
  threadTitle?: string
}

interface TelegramUpdate {
  message?: TelegramUpdateMessage
  channel_post?: TelegramUpdateMessage
  my_chat_member?: { chat: TelegramUpdateChat }
}
interface TelegramUpdateChat {
  id: number
  type: string
  title?: string
  first_name?: string
  last_name?: string
  username?: string
}
interface TelegramUpdateMessage {
  chat: TelegramUpdateChat
  message_thread_id?: number
  is_topic_message?: boolean
  reply_to_message?: { forum_topic_created?: { name?: string } }
}

/**
 * The chats that wrote to the bot recently (getUpdates keeps about 24 hours),
 * newest first, so "Find it for me" fills the chat ID and nobody has to open
 * api.telegram.org. Fails when the bot has a webhook set: Telegram then keeps
 * no updates to read.
 */
export async function findTelegramChats(
  botToken: string,
  ctx: { fetch: typeof fetch; signal?: AbortSignal },
): Promise<{ ok: true; chats: TelegramChat[] } | { ok: false; message: string }> {
  if (!/^\d+:[\w-]+$/.test(botToken)) return { ok: false, message: 'invalid-token' }
  const response = await ctx.fetch(`https://api.telegram.org/bot${botToken}/getUpdates`, {
    signal: ctx.signal,
  })
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean
    description?: string
    result?: TelegramUpdate[]
  } | null
  if (!response.ok || !body?.ok) {
    return { ok: false, message: body?.description ?? `HTTP ${response.status}` }
  }
  const found = new Map<string, TelegramChat>()
  for (const update of [...(body.result ?? [])].reverse()) {
    const message = update.message ?? update.channel_post
    const chat = message?.chat ?? update.my_chat_member?.chat
    if (!chat) continue
    const threadId =
      message?.is_topic_message && message.message_thread_id
        ? String(message.message_thread_id)
        : undefined
    const key = `${chat.id}:${threadId ?? ''}`
    if (found.has(key)) continue
    found.set(key, {
      id: String(chat.id),
      title:
        chat.title ??
        ([chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || ''),
      kind: chat.type === 'private' ? 'private' : chat.type === 'channel' ? 'channel' : 'group',
      threadId,
      threadTitle: message?.reply_to_message?.forum_topic_created?.name,
    })
  }
  return { ok: true, chats: [...found.values()] }
}
