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

const API = 'https://api.stripe.com/v1'
/** Pinned so the shapes below do not move under us. */
const VERSION = '2024-06-20'
/** Seconds a signed webhook stays valid, as Stripe's own libraries do. */
const TOLERANCE = 300

interface StripeList<T> {
  data: T[]
  has_more: boolean
}

interface StripeInvoice {
  id: string
  subscription?: string | null
  lines?: { data: { price?: { product?: string } | null }[] }
}

export interface StripeCharge {
  id: string
  amount: number
  amount_refunded: number
  currency: string
  status: 'succeeded' | 'pending' | 'failed'
  refunded: boolean
  created: number
  customer: string | null
  failure_code?: string | null
  failure_message?: string | null
  payment_method_details?: { type?: string } | null
  balance_transaction?: string | { fee: number } | null
  invoice?: string | StripeInvoice | null
  metadata?: Record<string, string>
}

export interface StripeSubscription {
  id: string
  status: string
  customer: string
  start_date: number
  canceled_at: number | null
  ended_at?: number | null
  metadata?: Record<string, string>
  items: {
    data: {
      quantity?: number
      price: {
        unit_amount: number | null
        currency: string
        product: string
        recurring?: { interval: string; interval_count: number } | null
      }
    }[]
  }
}

const headers = (config: MoneyConfig) => ({
  authorization: `Bearer ${config.key}`,
  'stripe-version': VERSION,
})

const get = <T>(config: MoneyConfig, ctx: IntegrationContext, path: string) =>
  getJson<T>(ctx, `${API}${path}`, headers(config))

function chargeStatus(c: StripeCharge): PaymentStatus {
  if (c.status === 'failed') return 'failed'
  if (c.status === 'pending') return 'pending'
  return c.refunded ? 'refunded' : 'paid'
}

export function stripePayment(c: StripeCharge): MoneyPayment {
  const invoice = typeof c.invoice === 'object' && c.invoice ? c.invoice : null
  const balance = typeof c.balance_transaction === 'object' ? c.balance_transaction : null
  return {
    id: c.id,
    status: chargeStatus(c),
    amount: c.amount,
    refunded: c.amount_refunded ?? 0,
    fee: balance ? balance.fee : null,
    currency: c.currency.toUpperCase(),
    method: c.payment_method_details?.type ?? '',
    customer: c.customer ?? '',
    subscriptionId: invoice?.subscription ?? '',
    at: new Date(c.created * 1000),
    failure: c.failure_code ?? c.failure_message ?? '',
    products: [
      ...new Set(
        (invoice?.lines?.data ?? []).flatMap((l) => (l.price?.product ? [l.price.product] : [])),
      ),
    ],
    tag: c.metadata?.product ?? '',
  }
}

const SUBSCRIPTION_STATUS: Record<string, SubscriptionStatus> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  unpaid: 'past_due',
  paused: 'paused',
  canceled: 'canceled',
  incomplete_expired: 'canceled',
}

export function stripeSubscription(s: StripeSubscription): MoneySubscription | null {
  const status = SUBSCRIPTION_STATUS[s.status]
  // "incomplete": the first payment never went through; not a subscription yet.
  if (!status) return null
  const items = s.items.data
  return {
    id: s.id,
    status,
    mrr: items.reduce(
      (sum, item) =>
        sum +
        perMonth(
          (item.price.unit_amount ?? 0) * (item.quantity ?? 1),
          item.price.recurring?.interval ?? 'month',
          item.price.recurring?.interval_count ?? 1,
        ),
      0,
    ),
    currency: (items[0]?.price.currency ?? 'usd').toUpperCase(),
    customer: s.customer,
    startedAt: new Date(s.start_date * 1000),
    canceledAt:
      status === 'canceled' ? new Date((s.ended_at ?? s.canceled_at ?? s.start_date) * 1000) : null,
    products: [...new Set(items.map((i) => i.price.product))],
    tag: s.metadata?.product ?? '',
  }
}

const CHARGE_EXPAND = 'expand[]=data.invoice&expand[]=data.balance_transaction'

/** Checks a `Stripe-Signature` header: `t=<unix>,v1=<hex>[,v1=...]`. */
export function verifyStripeSignature(
  body: string,
  header: string | null,
  secret: string,
  now: Date,
): void {
  if (!header) throw new WebhookSignatureError('missing Stripe-Signature')
  const parts = header.split(',').map((p) => p.split('=') as [string, string])
  const t = parts.find(([k]) => k === 't')?.[1]
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v)
  if (!t || signatures.length === 0) throw new WebhookSignatureError()
  if (Math.abs(now.getTime() / 1000 - Number(t)) > TOLERANCE)
    throw new WebhookSignatureError('webhook too old')
  const expected = hmacHex(secret, `${t}.${body}`)
  if (!signatures.some((s) => sameText(s, expected))) throw new WebhookSignatureError()
}

export const stripe: MoneyGateway = {
  id: 'stripe',
  name: 'Stripe',
  keyPlaceholder: 'rk_live_...',
  keyHelp: {
    en: 'Octadash only reads: charges, invoices, subscriptions, products and balance (for fees). It can’t charge, refund or change anything. Create it in Stripe › Developers › API keys › Create restricted key, with Read on those five, and nothing else. The key is stored encrypted and never comes back to the browser.',
    'pt-BR':
      'O Octadash só lê: cobranças (charges), faturas (invoices), assinaturas, produtos e saldo (para as taxas). Ele não cobra, não estorna e não muda nada. Crie em Stripe › Desenvolvedores › Chaves de API › Criar chave restrita, com Leitura nesses cinco e mais nada. A chave fica guardada criptografada e nunca volta para o navegador.',
  },
  hasProducts: true,

  async check(config, ctx) {
    if (/^sk_/.test(config.key))
      return {
        ok: false,
        message: 'This is a secret key, which can charge and refund. Use a restricted key.',
      }
    try {
      await get(config, ctx, `/charges?limit=1&${CHARGE_EXPAND}`)
      await get(config, ctx, '/subscriptions?limit=1&status=all')
      return { ok: true }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  },

  async products(config, ctx) {
    const out: { id: string; name: string }[] = []
    let after = ''
    for (let page = 0; page < 20; page++) {
      const list = await get<StripeList<{ id: string; name: string }>>(
        config,
        ctx,
        `/products?limit=100${after ? `&starting_after=${after}` : ''}`,
      )
      out.push(...list.data.map((p) => ({ id: p.id, name: p.name })))
      if (!list.has_more || list.data.length === 0) break
      after = list.data[list.data.length - 1]?.id ?? ''
    }
    return out
  },

  async *payments(config, ctx, since) {
    let after = ''
    for (;;) {
      const list = await get<StripeList<StripeCharge>>(
        config,
        ctx,
        `/charges?limit=100&created[gte]=${Math.floor(since.getTime() / 1000)}&${CHARGE_EXPAND}${after ? `&starting_after=${after}` : ''}`,
      )
      if (list.data.length > 0) yield list.data.map(stripePayment)
      if (!list.has_more || list.data.length === 0) return
      after = list.data[list.data.length - 1]?.id ?? ''
    }
  },

  async *subscriptions(config, ctx) {
    let after = ''
    for (;;) {
      const list = await get<StripeList<StripeSubscription>>(
        config,
        ctx,
        `/subscriptions?limit=100&status=all${after ? `&starting_after=${after}` : ''}`,
      )
      const page = list.data.map(stripeSubscription).filter((s) => s !== null)
      if (page.length > 0) yield page
      if (!list.has_more || list.data.length === 0) return
      after = list.data[list.data.length - 1]?.id ?? ''
    }
  },

  async webhook(input, config, ctx) {
    if (!config.webhookSecret) throw new WebhookSignatureError('no signing secret saved')
    verifyStripeSignature(
      input.body,
      input.headers.get('stripe-signature'),
      config.webhookSecret,
      input.received,
    )
    const event = JSON.parse(input.body) as { type: string; data: { object: { id: string } } }
    if (event.type.startsWith('charge.') && !event.type.startsWith('charge.dispute')) {
      // The event's charge is not expanded: read it again for its invoice and fee.
      const charge = await get<StripeCharge>(
        config,
        ctx,
        `/charges/${event.data.object.id}?expand[]=invoice&expand[]=balance_transaction`,
      )
      return { payments: [stripePayment(charge)], subscriptions: [] }
    }
    if (event.type.startsWith('customer.subscription.')) {
      const subscription = stripeSubscription(event.data.object as StripeSubscription)
      return { payments: [], subscriptions: subscription ? [subscription] : [] }
    }
    return { payments: [], subscriptions: [] }
  },
}
