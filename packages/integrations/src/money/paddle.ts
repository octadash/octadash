import type { IntegrationContext } from '../types'
import { getJson, hmacHex, perMonth, sameText } from './shared'
import {
  type MoneyConfig,
  type MoneyGateway,
  type MoneyPayment,
  type MoneySubscription,
  type PaymentStatus,
  type SubscriptionStatus,
  WebhookSignatureError,
} from './types'

const TOLERANCE = 300

interface PaddlePrice {
  product_id: string
  unit_price?: { amount: string; currency_code: string }
  billing_cycle?: { interval: string; frequency: number } | null
}

export interface PaddleTransaction {
  id: string
  status: string
  customer_id: string | null
  subscription_id: string | null
  currency_code: string
  created_at: string
  billed_at?: string | null
  custom_data?: Record<string, unknown> | null
  items: { price: PaddlePrice; quantity: number }[]
  details?: { totals?: { total: string; fee?: string | null } } | null
  payments?: { status: string; error_code?: string | null; method_details?: { type?: string } }[]
}

export interface PaddleSubscription {
  id: string
  status: string
  customer_id: string
  currency_code: string
  started_at: string | null
  created_at: string
  canceled_at: string | null
  custom_data?: Record<string, unknown> | null
  items: { price: PaddlePrice; quantity: number }[]
}

interface PaddleList<T> {
  data: T[]
  meta?: { pagination?: { next?: string; has_more?: boolean } }
}

/** Sandbox keys carry `_sdbx_`. */
export function paddleBase(key: string): string {
  return key.includes('_sdbx_') ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com'
}

const headers = (config: MoneyConfig) => ({ authorization: `Bearer ${config.key}` })

const get = <T>(config: MoneyConfig, ctx: IntegrationContext, pathOrUrl: string) =>
  getJson<T>(
    ctx,
    pathOrUrl.startsWith('https://') ? pathOrUrl : `${paddleBase(config.key)}${pathOrUrl}`,
    headers(config),
  )

/** Follows `meta.pagination.next` until it ends. */
async function* pages<T>(config: MoneyConfig, ctx: IntegrationContext, first: string) {
  let url: string | undefined = first
  for (let page = 0; url && page < 10_000; page++) {
    const list: PaddleList<T> = await get<PaddleList<T>>(config, ctx, url)
    if (list.data.length > 0) yield list.data
    url = list.meta?.pagination?.has_more ? list.meta.pagination.next : undefined
  }
}

const tagOf = (data: Record<string, unknown> | null | undefined) =>
  typeof data?.product === 'string' ? data.product : ''

const STATUS: Record<string, PaymentStatus> = {
  completed: 'paid',
  paid: 'paid',
  billed: 'pending',
  past_due: 'failed',
  canceled: 'canceled',
}

export function paddlePayment(t: PaddleTransaction): MoneyPayment | null {
  const status = STATUS[t.status]
  if (!status) return null
  const failed = [...(t.payments ?? [])]
    .reverse()
    .find((p) => p.status === 'error' || p.status === 'failed')
  const totals = t.details?.totals
  return {
    id: t.id,
    status,
    amount: Number(totals?.total ?? 0),
    refunded: 0,
    fee: totals?.fee == null ? null : Number(totals.fee),
    currency: t.currency_code.toUpperCase(),
    method: t.payments?.[0]?.method_details?.type ?? '',
    customer: t.customer_id ?? '',
    subscriptionId: t.subscription_id ?? '',
    at: new Date(t.billed_at ?? t.created_at),
    failure: status === 'failed' ? (failed?.error_code ?? 'past_due') : '',
    products: [...new Set(t.items.map((i) => i.price.product_id))],
    tag: tagOf(t.custom_data),
  }
}

const SUBSCRIPTION_STATUS: Record<string, SubscriptionStatus> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  paused: 'paused',
  canceled: 'canceled',
}

export function paddleSubscription(s: PaddleSubscription): MoneySubscription {
  const status = SUBSCRIPTION_STATUS[s.status] ?? 'active'
  return {
    id: s.id,
    status,
    mrr: s.items.reduce(
      (sum, item) =>
        sum +
        perMonth(
          Number(item.price.unit_price?.amount ?? 0) * (item.quantity ?? 1),
          item.price.billing_cycle?.interval ?? 'month',
          item.price.billing_cycle?.frequency ?? 1,
        ),
      0,
    ),
    currency: s.currency_code.toUpperCase(),
    customer: s.customer_id,
    startedAt: new Date(s.started_at ?? s.created_at),
    canceledAt: status === 'canceled' ? new Date(s.canceled_at ?? s.created_at) : null,
    products: [...new Set(s.items.map((i) => i.price.product_id))],
    tag: tagOf(s.custom_data),
  }
}

/** Checks a `Paddle-Signature` header: `ts=<unix>;h1=<hex>`. */
export function verifyPaddleSignature(
  body: string,
  header: string | null,
  secret: string,
  now: Date,
): void {
  if (!header) throw new WebhookSignatureError('missing Paddle-Signature')
  const parts = header.split(';').map((p) => p.split('=') as [string, string])
  const ts = parts.find(([k]) => k === 'ts')?.[1]
  const signatures = parts.filter(([k]) => k === 'h1').map(([, v]) => v)
  if (!ts || signatures.length === 0) throw new WebhookSignatureError()
  if (Math.abs(now.getTime() / 1000 - Number(ts)) > TOLERANCE)
    throw new WebhookSignatureError('webhook too old')
  const expected = hmacHex(secret, `${ts}:${body}`)
  if (!signatures.some((s) => sameText(s, expected))) throw new WebhookSignatureError()
}

export const paddle: MoneyGateway = {
  id: 'paddle',
  name: 'Paddle',
  keyPlaceholder: 'pdl_live_apikey_...',
  keyHelp: {
    en: 'Octadash only reads: transactions, subscriptions and products. Create the key in Paddle › Developer tools › Authentication with Read on those three, and nothing else. The key is stored encrypted and never comes back to the browser.',
    'pt-BR':
      'O Octadash só lê: transações, assinaturas e produtos. Crie a chave em Paddle › Developer tools › Authentication com Leitura nesses três e mais nada. A chave fica guardada criptografada e nunca volta para o navegador.',
  },
  hasProducts: true,

  async check(config, ctx) {
    try {
      await get(config, ctx, '/transactions?per_page=1')
      await get(config, ctx, '/subscriptions?per_page=1')
      return { ok: true }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  },

  async products(config, ctx) {
    const out: { id: string; name: string }[] = []
    for await (const page of pages<{ id: string; name: string }>(
      config,
      ctx,
      '/products?per_page=200&status=active',
    ))
      out.push(...page.map((p) => ({ id: p.id, name: p.name })))
    return out
  },

  async *payments(config, ctx, since) {
    for await (const page of pages<PaddleTransaction>(
      config,
      ctx,
      `/transactions?per_page=30&status=billed,paid,completed,past_due,canceled&created_at%5BGTE%5D=${since.toISOString()}`,
    )) {
      const payments = page.map(paddlePayment).filter((p) => p !== null)
      if (payments.length > 0) yield payments
    }
  },

  async *subscriptions(config, ctx) {
    for await (const page of pages<PaddleSubscription>(config, ctx, '/subscriptions?per_page=200'))
      yield page.map(paddleSubscription)
  },

  async webhook(input, config) {
    if (!config.webhookSecret) throw new WebhookSignatureError('no secret key saved')
    verifyPaddleSignature(
      input.body,
      input.headers.get('paddle-signature'),
      config.webhookSecret,
      input.received,
    )
    const event = JSON.parse(input.body) as { event_type: string; data: unknown }
    if (event.event_type.startsWith('transaction.')) {
      const payment = paddlePayment(event.data as PaddleTransaction)
      return { payments: payment ? [payment] : [], subscriptions: [] }
    }
    if (event.event_type.startsWith('subscription.'))
      return { payments: [], subscriptions: [paddleSubscription(event.data as PaddleSubscription)] }
    return { payments: [], subscriptions: [] }
  },
}
