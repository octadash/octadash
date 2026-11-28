/**
 * How a shared cost is divided between products, the same for every
 * provider and for fixed bills:
 *
 * - A product can claim the provider's own splits (`tags`: OpenAI projects,
 *   Anthropic workspaces). A tagged cost goes whole to the product that
 *   claims its tag.
 * - Everything else (untagged, or a tag nobody claims) is the rest. It goes
 *   to the products marked `rest`, divided equally, by each product's traffic
 *   that day, or by fixed percents (scaled to add up to 100).
 * - With no product taking the rest, it is left unassigned: still counted in
 *   the provider's total, in no product's.
 */
export interface CostShare {
  projectId: string
  tags: string[]
  rest: boolean
  /** For the fixed-percent split. */
  percent: number | null
}

export type SplitMode = 'equal' | 'traffic' | 'percent'

export const SPLIT_MODES: SplitMode[] = ['equal', 'traffic', 'percent']

export function splitCost(
  item: { tag: string; amount: number },
  shares: CostShare[],
  mode: SplitMode,
  /** Visitors per product on the item's day, for the traffic split. */
  traffic?: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>()
  if (item.tag) {
    const owner = shares.find((s) => s.tags.includes(item.tag))
    if (owner) {
      out.set(owner.projectId, item.amount)
      return out
    }
  }
  const rest = shares.filter((s) => s.rest)
  if (rest.length === 0) return out
  let weights = rest.map((s) =>
    mode === 'percent'
      ? Math.max(0, s.percent ?? 0)
      : mode === 'traffic'
        ? Math.max(0, traffic?.get(s.projectId) ?? 0)
        : 1,
  )
  // No traffic that day, or no percents typed: equal parts rather than nothing.
  if (weights.every((w) => w === 0)) weights = rest.map(() => 1)
  const total = weights.reduce((a, b) => a + b, 0)
  rest.forEach((s, i) => {
    const part = (item.amount * (weights[i] ?? 0)) / total
    if (part) out.set(s.projectId, (out.get(s.projectId) ?? 0) + part)
  })
  return out
}
