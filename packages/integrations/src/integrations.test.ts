import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { builtinIntegrations, telegram, webhook } from './builtin'
import { signBody } from './builtin/webhook'
import { IntegrationRegistry } from './registry'
import type { AlertMessage } from './types'

const message: AlertMessage = {
  severity: 'critical',
  title: 'postato.com.br is down',
  body: '3 failed checks in a row <timeout>',
  project: { id: 'p1', name: 'Postato' },
  url: 'https://octadash.example.com/p/p1',
  occurredAt: new Date('2026-11-27T12:00:00Z'),
}

function okFetch() {
  return vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch & {
    mock: { calls: [string, RequestInit][] }
  }
}

describe('registry', () => {
  it('registers the built-in integrations', () => {
    const registry = new IntegrationRegistry(builtinIntegrations)
    expect(registry.get('webhook')).toBe(webhook)
    expect(registry.list('notification').map((i) => i.id)).toEqual(['webhook', 'telegram'])
    expect(registry.list('source')).toEqual([])
  })

  it('refuses duplicates and bad ids', () => {
    const registry = new IntegrationRegistry([webhook as never])
    expect(() => registry.register(webhook as never)).toThrow('already registered')
    expect(() => registry.register({ ...webhook, id: 'Bad Id' } as never)).toThrow('kebab-case')
  })

  it('exposes every config as JSON Schema for the settings form', () => {
    for (const integration of builtinIntegrations) {
      const schema = z.toJSONSchema(integration.config) as { type: string }
      expect(schema.type).toBe('object')
    }
  })
})

describe('webhook', () => {
  it('posts a signed JSON alert', async () => {
    const fetchFn = okFetch()
    const cfg = webhook.config.parse({ url: 'https://hooks.example.com/x', secret: 'a'.repeat(16) })
    await webhook.send(message, cfg, { fetch: fetchFn })
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://hooks.example.com/x')
    const headers = init.headers as Record<string, string>
    expect(headers['x-octadash-signature']).toBe(signBody(init.body as string, 'a'.repeat(16)))
    expect(JSON.parse(init.body as string)).toMatchObject({
      severity: 'critical',
      project: { name: 'Postato' },
    })
  })

  it('reports a failing endpoint in test()', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch
    const result = await webhook.test({ url: 'https://hooks.example.com/x' }, { fetch: fetchFn })
    expect(result).toEqual({ ok: false, message: 'Webhook answered 500' })
  })
})

describe('telegram', () => {
  it('validates the bot token format', () => {
    expect(telegram.config.safeParse({ botToken: 'nope', chatId: '1' }).success).toBe(false)
  })

  it('sends escaped HTML to the bot API', async () => {
    const fetchFn = okFetch()
    await telegram.send(message, { botToken: '123:abc', chatId: '42' }, { fetch: fetchFn })
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.telegram.org/bot123:abc/sendMessage')
    const body = JSON.parse(init.body as string)
    expect(body.chat_id).toBe('42')
    expect(body.text).toContain('&lt;timeout&gt;')
    expect(body.text).toContain('<b>postato.com.br is down</b>')
  })
})
