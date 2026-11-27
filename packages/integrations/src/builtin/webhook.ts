import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { defineNotification } from '../define'
import type { AlertMessage } from '../types'

const config = z.object({
  url: z.url({ protocol: /^https?$/ }),
  /** When set, the body is signed with HMAC SHA-256 in the X-Octadash-Signature header. */
  secret: z.string().min(16).optional(),
})

export function webhookPayload(message: AlertMessage) {
  return {
    type: 'alert',
    severity: message.severity,
    title: message.title,
    body: message.body,
    project: message.project ?? null,
    url: message.url ?? null,
    occurred_at: message.occurredAt.toISOString(),
  }
}

export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

async function post(
  url: string,
  payload: unknown,
  secret: string | undefined,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
) {
  const body = JSON.stringify(payload)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'Octadash-Webhook',
  }
  if (secret) headers['x-octadash-signature'] = signBody(body, secret)
  const response = await fetchFn(url, { method: 'POST', headers, body, signal })
  if (!response.ok) throw new Error(`Webhook answered ${response.status}`)
}

export const webhook = defineNotification({
  id: 'webhook',
  kind: 'notification',
  name: 'Webhook',
  description: {
    en: 'Sends each alert as JSON to a URL you choose.',
    'pt-BR': 'Envia cada alerta em JSON para uma URL que você escolhe.',
  },
  config,
  secretKeys: ['secret'],
  async test(cfg, ctx) {
    try {
      await post(cfg.url, { type: 'test' }, cfg.secret, ctx.fetch, ctx.signal)
      return { ok: true }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  },
  async send(message, cfg, ctx) {
    await post(cfg.url, webhookPayload(message), cfg.secret, ctx.fetch, ctx.signal)
  },
})
