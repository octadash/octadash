import { anthropic } from './anthropic'
import { openai } from './openai'
import type { CostProvider } from './types'

export { anthropicCosts } from './anthropic'
export { openaiCosts } from './openai'
export * from './split'
export * from './types'
export { anthropic, openai }

/** Providers Costs reads from, in the order the form shows them. Fixed bills need no provider. */
export const COST_PROVIDERS: CostProvider[] = [openai, anthropic]

export function costProvider(id: string): CostProvider | undefined {
  return COST_PROVIDERS.find((p) => p.id === id)
}
