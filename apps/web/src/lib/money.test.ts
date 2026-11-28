import { describe, expect, it } from 'vitest'
import {
  digitsOf,
  formatMoney,
  isWebhookToken,
  modelOf,
  moneyHref,
  parseMoneyState,
  pointsBetween,
  shareOf,
} from './money'

describe('money state', () => {
  it('defaults to 30 days of revenue and ignores unknown values', () => {
    expect(parseMoneyState({})).toEqual({ period: '30d', metric: 'revenue' })
    expect(parseMoneyState({ period: 'year', metric: 'profit' })).toEqual({
      period: '30d',
      metric: 'revenue',
    })
    expect(parseMoneyState({ period: '7d', metric: 'mrr' })).toEqual({
      period: '7d',
      metric: 'mrr',
    })
  })

  it('keeps only what differs from the defaults in the address', () => {
    const state = parseMoneyState({})
    expect(moneyHref('/all/money', state, {})).toBe('/all/money')
    expect(moneyHref('/all/money', state, { metric: 'mrr', period: '7d' })).toBe(
      '/all/money?period=7d&metric=mrr',
    )
  })
})

describe('money numbers', () => {
  it('knows the digits of each currency', () => {
    expect(digitsOf('USD')).toBe(2)
    expect(digitsOf('JPY')).toBe(0)
    expect(digitsOf('nope')).toBe(2)
  })

  it('formats minor units', () => {
    expect(formatMoney(4182000, 'USD', 'en', true)).toBe('$41,820')
    expect(formatMoney(12990, 'BRL', 'pt-BR')).toMatch(/R\$\s?129,90/)
  })

  it('compares shares in points', () => {
    expect(shareOf(1, 4)).toBe(25)
    expect(shareOf(1, 0)).toBeNull()
    expect(pointsBetween(6.8, 1.8)).toBe(5)
    expect(pointsBetween(null, 2)).toBeNull()
  })

  it('accepts only 32 hex characters as a webhook token', () => {
    expect(isWebhookToken('581e159cf736959641db5577cfb123bb')).toBe(true)
    expect(isWebhookToken('581E159CF736959641DB5577CFB123BB')).toBe(false)
    expect(isWebhookToken('../etc')).toBe(false)
  })
})

describe('modelOf', () => {
  it('reads how a scope is paid for from its products', () => {
    expect(modelOf([])).toBe('recurring')
    expect(modelOf([{ recurring: true, oneOff: false }])).toBe('recurring')
    expect(modelOf([{ recurring: false, oneOff: true }])).toBe('oneOff')
    expect(modelOf([{ recurring: true, oneOff: true }])).toBe('mixed')
    // A credits product next to a subscription product: the scope is mixed.
    expect(
      modelOf([
        { recurring: false, oneOff: true },
        { recurring: true, oneOff: false },
      ]),
    ).toBe('mixed')
  })
})
