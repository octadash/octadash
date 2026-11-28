import { createHmac, timingSafeEqual } from 'node:crypto'
import type { IntegrationContext } from '../types'
import { GatewayError } from './types'

/** A recurring price as what it adds per month, rounded to the minor unit. */
export function perMonth(amount: number, interval: string, count = 1): number {
  const every = Math.max(1, count)
  switch (interval) {
    case 'day':
      return Math.round((amount * 365) / 12 / every)
    case 'week':
      return Math.round((amount * 52) / 12 / every)
    case 'year':
      return Math.round(amount / 12 / every)
    default:
      return Math.round(amount / every)
  }
}

export function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
}

export function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** GET a gateway's JSON; a non-2xx answer becomes a GatewayError with the gateway's message. */
export async function getJson<T>(
  ctx: IntegrationContext,
  url: string,
  headers: Record<string, string>,
): Promise<T> {
  const response = await ctx.fetch(url, { headers, signal: ctx.signal })
  const text = await response.text()
  if (!response.ok) {
    let message = text.slice(0, 300)
    try {
      const body = JSON.parse(text) as {
        error?: { message?: string; detail?: string }
        errors?: { description?: string }[]
      }
      message =
        body.error?.message ?? body.error?.detail ?? body.errors?.[0]?.description ?? message
    } catch {
      // Not JSON: keep the text.
    }
    throw new GatewayError(message || `HTTP ${response.status}`, response.status)
  }
  return JSON.parse(text) as T
}

/** Minor units from a decimal amount ("129.90" or 129.9) in a currency with cents. */
export function toMinor(value: number | string, currency: string): number {
  const digits =
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  return Math.round(Number(value) * 10 ** digits)
}
