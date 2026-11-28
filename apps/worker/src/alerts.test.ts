import { encryptSecret } from '@octadash/core'
import type { ChannelRow, PendingIncident } from '@octadash/db'
import { describe, expect, it } from 'vitest'
import { alertMessage, duration, failureText } from './alert-text'
import { channelConfig, planDeliveries } from './alerts'

const NOW = new Date('2026-11-28T12:10:00Z')
const SECRET = 'a'.repeat(40)

function incident(overrides: Partial<PendingIncident> = {}): PendingIncident {
  return {
    id: 'i1',
    org_id: 'o1',
    kind: 'monitor_down',
    level: 'emergency',
    data: { name: 'Site', url: 'https://example.com', reason: 'HTTP 503' },
    channel_ids: null,
    started_at: new Date('2026-11-28T12:03:00Z'),
    resolved_at: null,
    notified_open_at: null,
    parent_id: null,
    project_id: 'p1',
    project_name: 'Tribunal de Ideias',
    project_slug: 'tribunal',
    ...overrides,
  }
}

function channel(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: 'c1',
    org_id: 'o1',
    integration: 'telegram',
    name: 'Telegram',
    locale: 'pt-BR',
    config: { chatId: '42' },
    secrets: {},
    enabled: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

describe('alert text', () => {
  it('says one outage with its reason and how long', () => {
    const message = alertMessage([incident()], 'open', {
      now: NOW,
      locale: 'pt-BR',
      panelUrl: 'https://octa.example.com/',
    })
    expect(message.title).toBe('Site está fora do ar')
    expect(message.body).toBe('Respondeu HTTP 503. Fora do ar há 7 min.')
    expect(message.project?.name).toBe('Tribunal de Ideias')
    expect(message.url).toBe('https://octa.example.com/p/tribunal/uptime')
    expect(message.severity).toBe('critical')
  })

  it('says how long it was down when it comes back', () => {
    const message = alertMessage(
      [incident({ resolved_at: new Date('2026-11-28T13:33:00Z') })],
      'resolve',
      { now: NOW, locale: 'en', panelUrl: 'https://octa.example.com' },
    )
    expect(message.title).toBe('Site is back up')
    expect(message.body).toBe('It was down for 1 h 30 min.')
    expect(message.severity).toBe('resolved')
  })

  it('turns several outages into one message listing them', () => {
    const message = alertMessage(
      [
        incident(),
        incident({ id: 'i2', project_name: 'Intelibot', data: { name: 'API', reason: 'timeout' } }),
      ],
      'open',
      { now: NOW, locale: 'pt-BR', panelUrl: 'https://octa.example.com' },
    )
    expect(message.title).toBe('2 monitores fora do ar')
    expect(message.project).toBeUndefined()
    expect(message.url).toBe('https://octa.example.com/all/uptime')
    expect(message.body.split('\n')).toEqual([
      '• Tribunal de Ideias: Site está fora do ar. Respondeu HTTP 503. Fora do ar há 7 min.',
      '• Intelibot: API está fora do ar. Não respondeu a tempo. Fora do ar há 7 min.',
    ])
  })

  it('names heartbeats and certificates', () => {
    const missed = alertMessage(
      [
        incident({
          kind: 'heartbeat_missed',
          data: { name: 'Backup', reason: 'no ping for 65 min' },
        }),
      ],
      'open',
      { now: NOW, locale: 'en', panelUrl: 'https://x.dev' },
    )
    expect(missed.title).toBe('Backup did not check in')
    expect(missed.body).toBe('No ping for 65 min. Down for 7 min.')
    const cert = alertMessage(
      [
        incident({
          kind: 'cert_expiring',
          data: { name: 'Site', url: 'https://example.com', days: 5 },
        }),
      ],
      'open',
      { now: NOW, locale: 'pt-BR', panelUrl: 'https://x.dev' },
    )
    expect(cert.title).toBe('O certificado de Site vence em 5 dias')
  })

  it('formats durations and failures', () => {
    expect(duration(20_000, 'en')).toBe('1 min')
    expect(duration(26 * 3_600_000, 'pt-BR')).toBe('1 d 2 h')
    expect(failureText('ECONNREFUSED', 'pt-BR')).toBe('Conexão recusada')
    expect(failureText('weird', 'en')).toBe('weird')
  })
})

describe('deliveries', () => {
  it('sends to every channel of the organization when the rule names none', () => {
    const deliveries = planDeliveries(
      [incident(), incident({ id: 'i2' }), incident({ id: 'i3', org_id: 'o2' })],
      [
        channel(),
        channel({ id: 'c2', integration: 'webhook' }),
        channel({ id: 'c3', org_id: 'o2' }),
      ],
    )
    expect(deliveries.map((d) => [d.channel.id, d.event, d.incidents.map((i) => i.id)])).toEqual([
      ['c1', 'open', ['i1', 'i2']],
      ['c2', 'open', ['i1', 'i2']],
      ['c3', 'open', ['i3']],
    ])
  })

  it('keeps to the channels a rule names and splits opens from resolves', () => {
    const deliveries = planDeliveries(
      [
        incident({ channel_ids: ['c2'] }),
        incident({ id: 'i2', resolved_at: NOW, channel_ids: ['c2'] }),
      ],
      [channel(), channel({ id: 'c2' })],
    )
    expect(deliveries.map((d) => [d.channel.id, d.event])).toEqual([
      ['c2', 'open'],
      ['c2', 'resolve'],
    ])
  })

  it('decrypts the channel secrets into its settings', () => {
    const config = channelConfig(
      channel({ secrets: { botToken: encryptSecret('123:abc', SECRET) } }),
      SECRET,
    )
    expect(config).toEqual({ chatId: '42', botToken: '123:abc' })
  })
})
