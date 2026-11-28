import type { IntegrationContext } from '../types'
import { getJson, perMonth, sameText, toMinor } from './shared'
import {
  type MoneyConfig,
  type MoneyGateway,
  type MoneyPayment,
  type MoneySubscription,
  type PaymentStatus,
  WebhookSignatureError,
} from './types'

/** Asaas works in reais and in Brasília time, which has no daylight saving since 2019. */
const ZONE = '-03:00'
const PAGE = 100

export interface AsaasPayment {
  id: string
  customer: string
  subscription?: string | null
  value: number
  netValue?: number | null
  billingType: string
  status: string
  dateCreated: string
  paymentDate?: string | null
  confirmedDate?: string | null
  externalReference?: string | null
  deleted?: boolean
}

export interface AsaasSubscription {
  id: string
  customer: string
  value: number
  cycle: string
  status: string
  dateCreated: string
  externalReference?: string | null
  deleted?: boolean
}

interface AsaasList<T> {
  data: T[]
  hasMore: boolean
}

/** Production keys start with $aact_prod_, sandbox keys with $aact_hmlg_. */
export function asaasBase(key: string): string {
  return key.includes('_hmlg_') ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3'
}

const get = <T>(config: MoneyConfig, ctx: IntegrationContext, path: string) =>
  getJson<T>(ctx, `${asaasBase(config.key)}${path}`, {
    access_token: config.key,
    'user-agent': 'Octadash',
  })

const STATUS: Record<string, PaymentStatus> = {
  RECEIVED: 'paid',
  CONFIRMED: 'paid',
  RECEIVED_IN_CASH: 'paid',
  PENDING: 'pending',
  AWAITING_RISK_ANALYSIS: 'pending',
  OVERDUE: 'overdue',
  REFUNDED: 'refunded',
  REFUND_REQUESTED: 'refunded',
  REFUND_IN_PROGRESS: 'refunded',
  CHARGEBACK_REQUESTED: 'refunded',
  CHARGEBACK_DISPUTE: 'refunded',
  AWAITING_CHARGEBACK_REVERSAL: 'refunded',
  REPROVED_BY_RISK_ANALYSIS: 'failed',
}

/** The day in Brasília of a moment: "2026-11-28". */
const brDay = (date: Date) => new Date(date.getTime() - 3 * 3_600_000).toISOString().slice(0, 10)

/** A date ("2026-11-28") or date and time ("2026-11-28 14:30:00") in Brasília time. */
export function asaasTime(value: string): Date {
  const [day, time = '12:00:00'] = value.trim().split(' ')
  return new Date(`${day}T${time}${ZONE}`)
}

export function asaasPayment(p: AsaasPayment, event?: { name: string; at: Date }): MoneyPayment {
  let status = STATUS[p.status] ?? 'pending'
  if (p.deleted) status = 'canceled'
  // A refused card does not change the payment's status; the event says it.
  if (event?.name === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED') status = 'failed'
  const amount = toMinor(p.value, 'BRL')
  const day = (p.confirmedDate ?? p.paymentDate ?? p.dateCreated).slice(0, 10)
  return {
    id: p.id,
    status,
    amount,
    refunded: status === 'refunded' ? amount : 0,
    fee: p.netValue == null ? null : amount - toMinor(p.netValue, 'BRL'),
    currency: 'BRL',
    method: p.billingType
      .toLowerCase()
      .replace('credit_card', 'card')
      .replace('debit_card', 'card'),
    customer: p.customer,
    subscriptionId: p.subscription ?? '',
    // The list gives only the day; a webhook gives the moment.
    at: event && brDay(event.at) === day ? event.at : asaasTime(day),
    failure: status === 'failed' ? (event?.name ?? p.status) : '',
    products: [],
    tag: p.externalReference ?? '',
  }
}

const CYCLES: Record<string, [string, number]> = {
  WEEKLY: ['week', 1],
  BIWEEKLY: ['week', 2],
  MONTHLY: ['month', 1],
  BIMONTHLY: ['month', 2],
  QUARTERLY: ['month', 3],
  SEMIANNUALLY: ['month', 6],
  YEARLY: ['year', 1],
}

export function asaasSubscription(s: AsaasSubscription, seen: Date): MoneySubscription {
  const [interval, count] = CYCLES[s.cycle] ?? ['month', 1]
  const canceled = s.deleted || s.status !== 'ACTIVE'
  return {
    id: s.id,
    status: canceled ? 'canceled' : 'active',
    mrr: perMonth(toMinor(s.value, 'BRL'), interval, count),
    currency: 'BRL',
    customer: s.customer,
    startedAt: asaasTime(s.dateCreated),
    // Asaas does not say when it ended: the first time Octadash saw it ended.
    canceledAt: canceled ? seen : null,
    products: [],
    tag: s.externalReference ?? '',
  }
}

export const asaas: MoneyGateway = {
  id: 'asaas',
  name: 'Asaas',
  keyPlaceholder: '$aact_prod_...',
  keyHelp: {
    en: 'Octadash only reads payments and subscriptions. Asaas keys can also create charges, so make one just for Octadash in Asaas › Integrations › API key, and delete it to cut access. The key is stored encrypted, never comes back to the browser, and Octadash only ever sends GET requests with it.',
    'pt-BR':
      'O Octadash só lê cobranças e assinaturas. As chaves do Asaas também podem criar cobranças, então crie uma só para o Octadash em Asaas › Integrações › Chave de API, e apague-a para cortar o acesso. A chave fica guardada criptografada, nunca volta para o navegador, e o Octadash só faz leituras (GET) com ela.',
  },
  hasProducts: false,

  async check(config, ctx) {
    try {
      await get(config, ctx, '/payments?limit=1')
      await get(config, ctx, '/subscriptions?limit=1')
      return { ok: true }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  },

  async products() {
    return []
  },

  async *payments(config, ctx, since) {
    for (let offset = 0; ; offset += PAGE) {
      const list = await get<AsaasList<AsaasPayment>>(
        config,
        ctx,
        `/payments?limit=${PAGE}&offset=${offset}&dateCreated%5Bge%5D=${brDay(since)}`,
      )
      if (list.data.length > 0) yield list.data.map((p) => asaasPayment(p))
      if (!list.hasMore || list.data.length === 0) return
    }
  },

  async *subscriptions(config, ctx) {
    const seen = new Date()
    for (let offset = 0; ; offset += PAGE) {
      const list = await get<AsaasList<AsaasSubscription>>(
        config,
        ctx,
        `/subscriptions?limit=${PAGE}&offset=${offset}`,
      )
      if (list.data.length > 0) yield list.data.map((s) => asaasSubscription(s, seen))
      if (!list.hasMore || list.data.length === 0) return
    }
  },

  async webhook(input, config) {
    const token = input.headers.get('asaas-access-token')
    if (!config.webhookSecret || !token || !sameText(token, config.webhookSecret))
      throw new WebhookSignatureError()
    const event = JSON.parse(input.body) as {
      event: string
      dateCreated?: string
      payment?: AsaasPayment
      subscription?: AsaasSubscription
    }
    const at = event.dateCreated ? asaasTime(event.dateCreated) : input.received
    if (event.payment && event.event.startsWith('PAYMENT_'))
      return {
        payments: [asaasPayment(event.payment, { name: event.event, at })],
        subscriptions: [],
      }
    if (event.subscription && event.event.startsWith('SUBSCRIPTION_'))
      return { payments: [], subscriptions: [asaasSubscription(event.subscription, at)] }
    return { payments: [], subscriptions: [] }
  },
}
