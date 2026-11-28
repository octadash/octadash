import type { IntegrationContext, LocalizedText, TestResult } from '../types'

/**
 * What Costs reads from a provider, the same for every provider: what was
 * spent in a stretch of time, tagged with the provider's own split (an
 * OpenAI project, an Anthropic workspace, an AWS tag) so a shared account can
 * be divided between products. Amounts are in the currency's minor unit
 * (cents) and may have fractions: AI providers bill fractions of a cent.
 */
export interface CostItem {
  /** Start of the stretch: a day (00:00 UTC) or an hour. */
  at: Date
  /** 24 for a day, 1 for an hour. */
  hours: number
  /** The provider's split: project or workspace id; '' when none. */
  tag: string
  /** What was billed: a model, a service; '' when the provider does not say. */
  lineItem: string
  /** Minor units, fractions allowed. */
  amount: number
  /** ISO 4217, upper case. */
  currency: string
}

/** One of the provider's own splits, for "By OpenAI project". */
export interface CostTag {
  id: string
  name: string
}

export interface CostConfig {
  /** The read-only (admin) key. */
  key: string
}

/**
 * A provider Costs reads from. Read-only by contract: no method changes
 * anything at the provider. `costs` is called for at most `maxDays` at once.
 */
export interface CostProvider {
  /** Stored in the database; never renamed. */
  id: 'openai' | 'anthropic'
  name: string
  /** "AI": counted in "AI today" and in the AI note of the products table. */
  kind: 'ai' | 'cloud'
  keyPlaceholder: string
  keyHelp: LocalizedText
  /** What the provider's split is called: "project", "workspace". */
  tagName: LocalizedText
  /** Minutes between reads: AI providers every hour, cloud once a day. */
  every: number
  check(config: CostConfig, ctx: IntegrationContext): Promise<TestResult>
  tags(config: CostConfig, ctx: IntegrationContext): Promise<CostTag[]>
  /** Costs from `from` (inclusive) to `to` (exclusive), a page at a time. */
  costs(
    config: CostConfig,
    ctx: IntegrationContext,
    from: Date,
    to: Date,
  ): AsyncGenerator<CostItem[], void, undefined>
}
