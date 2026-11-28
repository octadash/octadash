import { AI_PRICES, AI_PRICES_DATE } from './ai-prices.data'

export { AI_PRICES_DATE }

/** A model's list price, in US dollars per million tokens. */
export interface AiPrice {
  /** The model name the price was found under. */
  model: string
  provider: string
  input: number
  output: number
  /** Cached input read; the input price when the list has none. */
  cacheRead: number
  /** Input written to the cache; the input price when the list has none. */
  cacheWrite: number
}

const KEYS = Object.keys(AI_PRICES).sort((a, b) => b.length - a.length)

/**
 * The list price of a model as apps name it: "gpt-4o-2024-08-06",
 * "openai/gpt-4o", "models/gemini-2.5-pro" or "claude-sonnet-4-5-20250929".
 * Exact names first, then without a date, then the longest listed name the
 * model starts with ("gpt-4o-mini-2024-07-18" is "gpt-4o-mini", not
 * "gpt-4o"). Null when the model is not listed.
 */
export function aiPrice(model: string): AiPrice | null {
  const name = model.trim().toLowerCase().replace(/^.*\//, '')
  if (!name) return null
  const undated = name.replace(/-(\d{4}-\d{2}-\d{2}|\d{8}|latest)$/, '')
  const key =
    [name, undated].find((n) => n in AI_PRICES) ??
    KEYS.find((k) => name.startsWith(`${k}-`) || name.startsWith(`${k}@`))
  const row = key ? AI_PRICES[key] : undefined
  if (!key || !row) return null
  const [provider, input, output, cacheRead, cacheWrite] = row
  return {
    model: key,
    provider,
    input,
    output,
    cacheRead: cacheRead ?? input,
    cacheWrite: cacheWrite ?? input,
  }
}

/** Tokens of one model call. `input` counts every input token, cached or not. */
export interface AiTokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/**
 * What a call cost at list price, in millionths of a US dollar. Cached tokens
 * are part of `input` and priced at their own rate.
 */
export function aiCostMicros(tokens: AiTokens, price: AiPrice): number {
  const plain = Math.max(0, tokens.input - tokens.cacheRead - tokens.cacheWrite)
  return Math.round(
    plain * price.input +
      tokens.cacheRead * price.cacheRead +
      tokens.cacheWrite * price.cacheWrite +
      tokens.output * price.output,
  )
}
