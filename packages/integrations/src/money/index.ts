import { asaas } from './asaas'
import { paddle } from './paddle'
import { stripe } from './stripe'
import type { MoneyGateway } from './types'

export * from './match'
export { perMonth, toMinor } from './shared'
export * from './types'
export { asaas, paddle, stripe }

/** Gateways Money reads from, in the order the form shows them. */
export const MONEY_GATEWAYS: MoneyGateway[] = [stripe, asaas, paddle]

export function moneyGateway(id: string): MoneyGateway | undefined {
  return MONEY_GATEWAYS.find((g) => g.id === id)
}
