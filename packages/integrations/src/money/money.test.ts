import { describe, expect, it } from 'vitest'
import {
  asaas,
  matchProject,
  paddle,
  perMonth,
  stripe,
  toMinor,
  WebhookSignatureError,
} from './index'
import { hmacHex } from './shared'

type Route = (url: URL, init?: RequestInit) => unknown

/** A fetch that answers from a table of path → body and records what was asked. */
function fakeFetch(routes: Record<string, Route | unknown>) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url: url.toString(), headers: (init?.headers ?? {}) as Record<string, string> })
    const route = routes[url.pathname]
    if (route === undefined) return new Response('{"error":{"message":"nope"}}', { status: 404 })
    const body = typeof route === 'function' ? (route as Route)(url, init) : route
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

const collect = async <T>(pages: AsyncGenerator<T[]>) => {
  const out: T[] = []
  for await (const page of pages) out.push(...page)
  return out
}

describe('shared', () => {
  it('turns prices into per month', () => {
    expect(perMonth(12000, 'year')).toBe(1000)
    expect(perMonth(3000, 'month', 3)).toBe(1000)
    expect(perMonth(1000, 'week')).toBe(4333)
    expect(toMinor('129.90', 'BRL')).toBe(12990)
    expect(toMinor(500, 'JPY')).toBe(500)
  })

  it('matches the most specific rule first', () => {
    const rules = [
      { projectId: 'shop', rule: { mode: 'all' as const } },
      { projectId: 'pay', rule: { mode: 'metadata' as const, values: ['acme-pay'] } },
      { projectId: 'app', rule: { mode: 'products' as const, values: ['prod_app'] } },
    ]
    expect(matchProject({ products: [], tag: 'acme-pay' }, rules)).toBe('pay')
    expect(matchProject({ products: ['prod_app'], tag: '' }, rules)).toBe('app')
    expect(matchProject({ products: ['prod_x'], tag: 'other' }, rules)).toBe('shop')
    expect(matchProject({ products: [], tag: '' }, rules.slice(1))).toBeNull()
  })
})

describe('stripe', () => {
  const charge = {
    id: 'ch_1',
    amount: 8400,
    amount_refunded: 0,
    currency: 'usd',
    status: 'succeeded',
    refunded: false,
    created: 1_764_300_000,
    customer: 'cus_1',
    payment_method_details: { type: 'card' },
    balance_transaction: { fee: 274 },
    invoice: {
      id: 'in_1',
      subscription: 'sub_1',
      lines: { data: [{ price: { product: 'prod_a' } }] },
    },
    metadata: { product: 'acme-shop' },
  }
  const failed = {
    ...charge,
    id: 'ch_2',
    status: 'failed',
    failure_code: 'card_declined',
    invoice: null,
    balance_transaction: null,
  }
  const subscription = {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    start_date: 1_760_000_000,
    canceled_at: null,
    items: {
      data: [
        {
          quantity: 2,
          price: {
            unit_amount: 1500,
            currency: 'usd',
            product: 'prod_a',
            recurring: { interval: 'month', interval_count: 1 },
          },
        },
        {
          quantity: 1,
          price: {
            unit_amount: 12000,
            currency: 'usd',
            product: 'prod_b',
            recurring: { interval: 'year', interval_count: 1 },
          },
        },
      ],
    },
  }

  it('reads charges page by page with the pinned version', async () => {
    let page = 0
    const { fetch, calls } = fakeFetch({
      '/v1/charges': () =>
        page++ === 0 ? { data: [charge], has_more: true } : { data: [failed], has_more: false },
    })
    const payments = await collect(
      stripe.payments({ key: 'rk_test_1' }, { fetch }, new Date(1_764_000_000_000)),
    )
    expect(payments).toHaveLength(2)
    expect(payments[0]).toMatchObject({
      id: 'ch_1',
      status: 'paid',
      amount: 8400,
      fee: 274,
      currency: 'USD',
      method: 'card',
      subscriptionId: 'sub_1',
      products: ['prod_a'],
      tag: 'acme-shop',
    })
    expect(payments[1]).toMatchObject({ status: 'failed', failure: 'card_declined', fee: null })
    expect(calls[0]?.headers['stripe-version']).toBe('2024-06-20')
    expect(calls[0]?.url).toContain('created[gte]=1764000000')
    expect(calls[1]?.url).toContain('starting_after=ch_1')
  })

  it('turns subscriptions into MRR', async () => {
    const { fetch } = fakeFetch({
      '/v1/subscriptions': {
        data: [
          subscription,
          { ...subscription, id: 'sub_2', status: 'incomplete' },
          {
            ...subscription,
            id: 'sub_3',
            status: 'canceled',
            canceled_at: 1_764_000_000,
            ended_at: 1_764_100_000,
          },
        ],
        has_more: false,
      },
    })
    const subs = await collect(stripe.subscriptions({ key: 'rk_test_1' }, { fetch }))
    expect(subs.map((s) => s.id)).toEqual(['sub_1', 'sub_3'])
    expect(subs[0]).toMatchObject({
      mrr: 4000,
      currency: 'USD',
      status: 'active',
      canceledAt: null,
    })
    expect(subs[1]?.canceledAt?.getTime()).toBe(1_764_100_000_000)
  })

  it('refuses a secret key', async () => {
    const { fetch } = fakeFetch({})
    expect((await stripe.check({ key: 'sk_live_1' }, { fetch })).ok).toBe(false)
  })

  it('checks the webhook signature and reads the charge again', async () => {
    const body = JSON.stringify({ type: 'charge.succeeded', data: { object: { id: 'ch_1' } } })
    const now = new Date(1_764_300_000_000)
    const t = Math.floor(now.getTime() / 1000)
    const signature = `t=${t},v1=${hmacHex('whsec_1', `${t}.${body}`)}`
    const { fetch, calls } = fakeFetch({ '/v1/charges/ch_1': charge })
    const result = await stripe.webhook(
      { body, headers: new Headers({ 'stripe-signature': signature }), received: now },
      { key: 'rk_test_1', webhookSecret: 'whsec_1' },
      { fetch },
    )
    expect(result.payments[0]?.id).toBe('ch_1')
    expect(calls[0]?.url).toContain('expand[]=invoice')
    await expect(
      stripe.webhook(
        {
          body: `${body} `,
          headers: new Headers({ 'stripe-signature': signature }),
          received: now,
        },
        { key: 'rk_test_1', webhookSecret: 'whsec_1' },
        { fetch },
      ),
    ).rejects.toBeInstanceOf(WebhookSignatureError)
    await expect(
      stripe.webhook(
        {
          body,
          headers: new Headers({ 'stripe-signature': signature }),
          received: new Date(now.getTime() + 600_000),
        },
        { key: 'rk_test_1', webhookSecret: 'whsec_1' },
        { fetch },
      ),
    ).rejects.toThrow('too old')
  })
})

describe('asaas', () => {
  const payment = {
    id: 'pay_1',
    customer: 'cus_1',
    subscription: 'sub_1',
    value: 129.9,
    netValue: 127.91,
    billingType: 'PIX',
    status: 'RECEIVED',
    dateCreated: '2026-11-27',
    paymentDate: '2026-11-27',
    externalReference: 'acme-shop',
  }

  it('picks sandbox or production by the key', async () => {
    const { fetch, calls } = fakeFetch({ '/v3/payments': { data: [payment], hasMore: false } })
    const payments = await collect(
      asaas.payments({ key: '$aact_hmlg_1' }, { fetch }, new Date('2026-11-01T12:00:00Z')),
    )
    expect(calls[0]?.url).toContain('https://api-sandbox.asaas.com/v3/payments')
    expect(calls[0]?.url).toContain('dateCreated%5Bge%5D=2026-11-01')
    expect(calls[0]?.headers.access_token).toBe('$aact_hmlg_1')
    expect(payments[0]).toMatchObject({
      status: 'paid',
      amount: 12990,
      fee: 199,
      currency: 'BRL',
      method: 'pix',
      tag: 'acme-shop',
    })
    expect(payments[0]?.at.toISOString()).toBe('2026-11-27T15:00:00.000Z')
  })

  it('turns cycles into MRR and marks ended subscriptions', () => {
    const seen = new Date('2026-11-28T00:00:00Z')
    return collect(
      asaas.subscriptions(
        { key: '$aact_prod_1' },
        {
          fetch: fakeFetch({
            '/v3/subscriptions': {
              data: [
                {
                  id: 'sub_1',
                  customer: 'c',
                  value: 360,
                  cycle: 'YEARLY',
                  status: 'ACTIVE',
                  dateCreated: '2026-01-10',
                },
                {
                  id: 'sub_2',
                  customer: 'c',
                  value: 30,
                  cycle: 'MONTHLY',
                  status: 'INACTIVE',
                  dateCreated: '2026-01-10',
                },
              ],
              hasMore: false,
            },
          }).fetch,
        },
      ),
    ).then((subs) => {
      expect(subs[0]).toMatchObject({ mrr: 3000, status: 'active', canceledAt: null })
      expect(subs[1]?.status).toBe('canceled')
      expect(subs[1]?.canceledAt?.getTime()).toBeGreaterThanOrEqual(seen.getTime())
    })
  })

  it('checks the access token and reads a refused card', async () => {
    const body = JSON.stringify({
      event: 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
      dateCreated: '2026-11-28 10:15:00',
      payment: {
        ...payment,
        billingType: 'CREDIT_CARD',
        status: 'PENDING',
        dateCreated: '2026-11-28',
        paymentDate: null,
      },
    })
    const { fetch } = fakeFetch({})
    const result = await asaas.webhook(
      { body, headers: new Headers({ 'asaas-access-token': 'tok' }), received: new Date() },
      { key: '$aact_prod_1', webhookSecret: 'tok' },
      { fetch },
    )
    expect(result.payments[0]).toMatchObject({ status: 'failed', method: 'card' })
    expect(result.payments[0]?.at.toISOString()).toBe('2026-11-28T13:15:00.000Z')
    await expect(
      asaas.webhook(
        { body, headers: new Headers({ 'asaas-access-token': 'other' }), received: new Date() },
        { key: '$aact_prod_1', webhookSecret: 'tok' },
        { fetch },
      ),
    ).rejects.toBeInstanceOf(WebhookSignatureError)
  })
})

describe('paddle', () => {
  const transaction = {
    id: 'txn_1',
    status: 'completed',
    customer_id: 'ctm_1',
    subscription_id: 'sub_1',
    currency_code: 'USD',
    created_at: '2026-11-28T01:09:00Z',
    billed_at: '2026-11-28T01:09:05Z',
    custom_data: { product: 'acme-app' },
    items: [{ quantity: 1, price: { product_id: 'pro_1' } }],
    details: { totals: { total: '2900', fee: '195' } },
    payments: [{ status: 'captured', method_details: { type: 'card' } }],
  }

  it('follows pagination and reads totals in minor units', async () => {
    let page = 0
    const { fetch, calls } = fakeFetch({
      '/transactions': () =>
        page++ === 0
          ? {
              data: [transaction],
              meta: {
                pagination: {
                  has_more: true,
                  next: 'https://sandbox-api.paddle.com/transactions?after=txn_1',
                },
              },
            }
          : {
              data: [
                {
                  ...transaction,
                  id: 'txn_2',
                  status: 'past_due',
                  payments: [{ status: 'error', error_code: 'declined' }],
                },
                { ...transaction, id: 'txn_3', status: 'draft' },
              ],
              meta: { pagination: { has_more: false } },
            },
    })
    const payments = await collect(
      paddle.payments({ key: 'pdl_sdbx_apikey_1' }, { fetch }, new Date('2026-11-01T00:00:00Z')),
    )
    expect(calls[0]?.url).toContain('https://sandbox-api.paddle.com/transactions')
    expect(calls[1]?.url).toContain('after=txn_1')
    expect(payments.map((p) => p.id)).toEqual(['txn_1', 'txn_2'])
    expect(payments[0]).toMatchObject({
      status: 'paid',
      amount: 2900,
      fee: 195,
      tag: 'acme-app',
      products: ['pro_1'],
    })
    expect(payments[1]).toMatchObject({ status: 'failed', failure: 'declined' })
  })

  it('checks the webhook signature', async () => {
    const body = JSON.stringify({
      event_type: 'subscription.canceled',
      data: {
        id: 'sub_1',
        status: 'canceled',
        customer_id: 'ctm_1',
        currency_code: 'USD',
        started_at: '2026-01-01T00:00:00Z',
        created_at: '2026-01-01T00:00:00Z',
        canceled_at: '2026-11-28T00:00:00Z',
        items: [
          {
            quantity: 1,
            price: {
              product_id: 'pro_1',
              unit_price: { amount: '2900', currency_code: 'USD' },
              billing_cycle: { interval: 'month', frequency: 1 },
            },
          },
        ],
      },
    })
    const now = new Date('2026-11-28T00:00:10Z')
    const ts = Math.floor(now.getTime() / 1000)
    const signature = `ts=${ts};h1=${hmacHex('pdl_ntfset_1', `${ts}:${body}`)}`
    const result = await paddle.webhook(
      { body, headers: new Headers({ 'paddle-signature': signature }), received: now },
      { key: 'pdl_live_apikey_1', webhookSecret: 'pdl_ntfset_1' },
      { fetch: fakeFetch({}).fetch },
    )
    expect(result.subscriptions[0]).toMatchObject({ status: 'canceled', mrr: 2900 })
    await expect(
      paddle.webhook(
        { body, headers: new Headers({ 'paddle-signature': `ts=${ts};h1=00` }), received: now },
        { key: 'pdl_live_apikey_1', webhookSecret: 'pdl_ntfset_1' },
        { fetch: fakeFetch({}).fetch },
      ),
    ).rejects.toBeInstanceOf(WebhookSignatureError)
  })
})
