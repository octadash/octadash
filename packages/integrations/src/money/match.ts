/**
 * Which product a payment or subscription belongs to, when one gateway
 * account serves several products. Each product of the connection picks its
 * payments by one rule; the most specific rule wins, so nothing counts twice.
 */
export type MatchRule =
  /** The whole account is this product's. */
  | { mode: 'all' }
  /** Payments that include one of these gateway products. */
  | { mode: 'products'; values: string[] }
  /** Payments whose `product` metadata (or Asaas external reference) is one of these. */
  | { mode: 'metadata'; values: string[] }

export interface ProductRule {
  projectId: string
  rule: MatchRule
}

const SPECIFIC = { metadata: 0, products: 1, all: 2 } as const

export function matchProject(
  item: { products: string[]; tag: string },
  rules: ProductRule[],
): string | null {
  const sorted = [...rules].sort((a, b) => SPECIFIC[a.rule.mode] - SPECIFIC[b.rule.mode])
  for (const { projectId, rule } of sorted) {
    if (rule.mode === 'all') return projectId
    if (rule.mode === 'metadata' && item.tag && rule.values.includes(item.tag)) return projectId
    if (rule.mode === 'products' && item.products.some((p) => rule.values.includes(p)))
      return projectId
  }
  return null
}
