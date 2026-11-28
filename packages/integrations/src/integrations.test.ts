import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  builtinIntegrations,
  findTelegramChats,
  isEmailIntegration,
  resend,
  sendDirectEmail,
  smtp,
  telegram,
  webhook,
} from './builtin'
import { emailSubject, splitAddresses } from './builtin/email'
import { signBody } from './builtin/webhook'
import { formFields, splitSecrets } from './form'
import { IntegrationRegistry } from './registry'
import type { AlertMessage } from './types'

const message: AlertMessage = {
  severity: 'critical',
  title: 'pagebird.com.br is down',
  body: '3 failed checks in a row <timeout>',
  project: { id: 'p1', name: 'Pagebird' },
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
    expect(registry.list('notification').map((i) => i.id)).toEqual([
      'smtp',
      'resend',
      'telegram',
      'webhook',
    ])
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
      project: { name: 'Pagebird' },
    })
  })

  it('reports a failing endpoint in test()', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch
    const result = await webhook.test({ url: 'https://hooks.example.com/x' }, { fetch: fetchFn })
    expect(result).toEqual({ ok: false, message: 'Webhook answered 500' })
  })
})

describe('direct email', () => {
  it('writes to one person through the channel account, not to its recipients', async () => {
    const fetchFn = okFetch()
    await sendDirectEmail(
      'resend',
      { apiKey: 're_123', from: 'Octadash <alerts@acme.test>', to: 'ops@acme.test' },
      { to: 'new@acme.test', subject: 'Join', text: 'Link' },
      { fetch: fetchFn },
    )
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Octadash <alerts@acme.test>',
      to: ['new@acme.test'],
      subject: 'Join',
      text: 'Link',
    })
    expect(isEmailIntegration('smtp')).toBe(true)
    expect(isEmailIntegration('telegram')).toBe(false)
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
    expect(body.text).toContain('<b>pagebird.com.br is down</b>')
  })

  it('finds the chats that wrote to the bot, newest first, with topics', async () => {
    const updates = [
      { message: { chat: { id: 7, type: 'private', first_name: 'Ana', last_name: 'Lima' } } },
      {
        message: {
          chat: { id: -1001, type: 'supergroup', title: 'On call' },
          is_topic_message: true,
          message_thread_id: 5,
          reply_to_message: { forum_topic_created: { name: 'Alerts' } },
        },
      },
      { message: { chat: { id: 7, type: 'private', first_name: 'Ana' } } },
    ]
    const fetchFn = vi.fn(async () => Response.json({ ok: true, result: updates }))
    const found = await findTelegramChats('123:abc', { fetch: fetchFn as typeof fetch })
    expect(found).toEqual({
      ok: true,
      chats: [
        { id: '7', title: 'Ana', kind: 'private', threadId: undefined, threadTitle: undefined },
        { id: '-1001', title: 'On call', kind: 'group', threadId: '5', threadTitle: 'Alerts' },
      ],
    })
    const conflict = vi.fn(async () =>
      Response.json({ ok: false, description: 'Conflict: webhook is active' }, { status: 409 }),
    )
    expect(await findTelegramChats('123:abc', { fetch: conflict as typeof fetch })).toEqual({
      ok: false,
      message: 'Conflict: webhook is active',
    })
    expect((await findTelegramChats('bad', { fetch: fetchFn as typeof fetch })).ok).toBe(false)
  })
})

describe('email', () => {
  it('validates the recipients and builds the subject', () => {
    expect(splitAddresses(' a@x.com, b@y.com ,')).toEqual(['a@x.com', 'b@y.com'])
    expect(
      smtp.config.safeParse({ host: 'smtp.x.com', from: 'o@x.com', to: 'a@x.com, nope' }).success,
    ).toBe(false)
    expect(smtp.config.parse({ host: 'smtp.x.com', from: 'o@x.com', to: 'a@x.com' })).toMatchObject(
      {
        port: 587,
        secure: false,
      },
    )
    expect(emailSubject(message)).toBe('[Octadash] Pagebird: pagebird.com.br is down')
  })

  it('sends through the Resend API', async () => {
    const fetchFn = okFetch()
    const cfg = resend.config.parse({ apiKey: 're_123', from: 'Octadash <o@x.com>', to: 'a@x.com' })
    await resend.send(message, cfg, { fetch: fetchFn })
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_123')
    expect(JSON.parse(init.body as string)).toMatchObject({
      to: ['a@x.com'],
      subject: emailSubject(message),
    })
  })
})

describe('settings forms', () => {
  it('reads the fields from the schema', () => {
    const fields = formFields(smtp)
    expect(fields.map((f) => [f.key, f.type, f.required, f.secret])).toEqual([
      ['host', 'text', true, false],
      ['port', 'number', false, false],
      ['secure', 'boolean', false, false],
      ['username', 'text', false, false],
      ['password', 'text', false, true],
      ['from', 'text', true, false],
      ['to', 'text', true, false],
    ])
    expect(fields.find((f) => f.key === 'port')?.default).toBe(587)
  })

  it('keeps secrets apart from the plain settings', () => {
    expect(splitSecrets(telegram, { botToken: '1:a', chatId: '42', threadId: '' })).toEqual({
      plain: { chatId: '42' },
      secrets: { botToken: '1:a' },
    })
  })
})
