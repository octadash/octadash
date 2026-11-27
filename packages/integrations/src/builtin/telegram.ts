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
