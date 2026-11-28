import type { IntegrationContext, LocalizedText, TestResult } from '../types'

/**
 * What Money reads from a payment gateway, the same for every gateway.
 * Amounts are integers in the currency's minor unit (cents), as the gateways
 * send them; nothing is converted here.
 */

/** paid: money in. failed: a charge the bank or gateway refused. overdue: a bill not paid by its date. */
export type PaymentStatus = 'paid' | 'failed' | 'pending' | 'overdue' | 'refunded' | 'canceled'

export interface MoneyPayment {
  /** The gateway's id: ch_..., pay_..., txn_... */
  id: string
  status: PaymentStatus
  /** Charged, in minor units. */
  amount: number
  /** Given back, in minor units (0 when nothing was). */
  refunded: number
  /** The gateway's fee, in minor units; null when the gateway does not say. */
  fee: number | null
  /** ISO 4217, upper case. */
  currency: string
  /** card, pix, boleto, paypal... lower case; '' when unknown. */
  method: string
  /** The gateway's customer id ('' when none). Stored only as a hash. */
  customer: string
  subscriptionId: string
  /** When the charge happened (paid, failed or was created). */
  at: Date
  /** Why it failed, as the gateway says it ('' when it did not). */
  failure: string
  /** Gateway product ids in it, for "Only these products". */
  products: string[]
  /** The `product` metadata (Stripe), custom data (Paddle) or external reference (Asaas). */
  tag: string
}

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'paused' | 'canceled'

export interface MoneySubscription {
  id: string
  status: SubscriptionStatus
  /** What it adds to MRR: the price per month, in minor units. */
  mrr: number
  currency: string
  customer: string
  startedAt: Date
  canceledAt: Date | null
  products: string[]
  tag: string
}

export interface GatewayProduct {
  id: string
  name: string
}

/** What a webhook brought, already in Money's shape. */
export interface WebhookResult {
  payments: MoneyPayment[]
  subscriptions: MoneySubscription[]
}

export interface MoneyConfig {
  /** The read-only key. */
  key: string
  /** Webhook signing secret (Stripe, Paddle) or access token (Asaas). */
  webhookSecret?: string
}

export interface WebhookInput {
  /** The body exactly as it arrived; signatures are over these bytes. */
  body: string
  headers: Headers
  /** When it arrived. */
  received: Date
}

/**
 * A payment gateway Money reads from. Read-only by contract: no method
 * charges, refunds or changes anything at the gateway.
 */
export interface MoneyGateway {
  /** Stored in the database; never renamed. */
  id: 'stripe' | 'asaas' | 'paddle'
  name: string
  /** What the key looks like, for the form. */
  keyPlaceholder: string
  /** Which permissions the key needs, for the "i" next to it. */
  keyHelp: LocalizedText
  /** Whether payments can be split by the gateway's products. */
  hasProducts: boolean
  /** Checks the key reads what Money needs. */
  check(config: MoneyConfig, ctx: IntegrationContext): Promise<TestResult>
  products(config: MoneyConfig, ctx: IntegrationContext): Promise<GatewayProduct[]>
  /** Payments created since `since`, a page at a time. */
  payments(
    config: MoneyConfig,
    ctx: IntegrationContext,
    since: Date,
  ): AsyncGenerator<MoneyPayment[], void, undefined>
  /** Every subscription the account has, a page at a time. */
  subscriptions(
    config: MoneyConfig,
    ctx: IntegrationContext,
  ): AsyncGenerator<MoneySubscription[], void, undefined>
  /**
   * Checks a webhook's signature and turns it into payments and
   * subscriptions. Throws `WebhookSignatureError` when the signature is wrong;
   * returns empty lists for events Money does not use.
   */
  webhook(input: WebhookInput, config: MoneyConfig, ctx: IntegrationContext): Promise<WebhookResult>
}

export class WebhookSignatureError extends Error {
  constructor(message = 'bad webhook signature') {
    super(message)
    this.name = 'WebhookSignatureError'
  }
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}
