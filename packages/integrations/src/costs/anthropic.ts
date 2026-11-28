import { getJson } from '../money/shared'
import type { IntegrationContext } from '../types'
import type { CostConfig, CostItem, CostProvider, CostTag } from './types'

const BASE = 'https://api.anthropic.com/v1/organizations'
/** The cost report reaches no earlier than this. */
const EARLIEST = Date.parse('2026-01-01T00:00:00Z')
const DAY = 86_400_000

const get = <T>(config: CostConfig, ctx: IntegrationContext, path: string) =>
  getJson<T>(ctx, `${BASE}${path}`, {
    'x-api-key': config.key,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'analytics-usage-cost-2026-08-24',
    'user-agent': 'Octadash',
  })

interface CostPage {
  data: {
    starting_at: string
    ending_at: string
    group: { workspace_id?: string | null; model?: string | null }
    cost: { amount: string; currency: string }
  }[]
  has_more: boolean
  next_page: string | null
}

interface WorkspacesPage {
  data: { id: string; name: string }[]
  has_more: boolean
  last_id?: string | null
}

/** Anthropic's rows: amounts are decimal strings in cents already. */
export function anthropicCosts(page: CostPage): CostItem[] {
  return page.data.flatMap((row) => {
    const amount = Number(row.cost.amount)
    if (!amount) return []
    const at = new Date(row.starting_at)
    const hours = Math.max(1, Math.round((Date.parse(row.ending_at) - at.getTime()) / 3_600_000))
    return [
      {
        at,
        hours,
        tag: row.group.workspace_id ?? '',
        lineItem: row.group.model ?? '',
        amount,
        currency: (row.cost.currency || 'USD').toUpperCase(),
      },
    ]
  })
}

/**
 * Anthropic, read with an Admin API key (sk-ant-admin...) through the cost
 * analytics report, by workspace and model, in hours. The report refreshes
 * about every 4 hours, so the last hours fill in late.
 */
export const anthropic: CostProvider = {
  id: 'anthropic',
  name: 'Anthropic',
  kind: 'ai',
  keyPlaceholder: 'sk-ant-admin01-...',
  keyHelp: {
    en: 'An Admin API key reads the cost report; Octadash never calls a model or changes the organization with it. Admins create it in Claude Console › Settings › Admin keys. The key is stored encrypted and never comes back to the browser.',
    'pt-BR':
      'Uma chave de Admin API lê o relatório de custos; o Octadash nunca chama um modelo nem muda a organização com ela. Admins criam em Claude Console › Settings › Admin keys. A chave fica guardada criptografada e nunca volta para o navegador.',
  },
  tagName: { en: 'workspace', 'pt-BR': 'workspace' },
  every: 60,
  async check(config, ctx) {
    if (!config.key.startsWith('sk-ant-admin'))
      return {
        ok: false,
        message: 'Use an Admin API key (sk-ant-admin...); a regular key cannot read costs.',
      }
    const start = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - DAY)
    await get(config, ctx, `/analytics/cost?starting_at=${start.toISOString()}&limit=1`)
    return { ok: true }
  },
  async tags(config, ctx) {
    const tags: CostTag[] = []
    let after = ''
    for (let i = 0; i < 20; i++) {
      const page = await get<WorkspacesPage>(
        config,
        ctx,
        `/workspaces?limit=100${after ? `&after_id=${after}` : ''}`,
      )
      tags.push(...page.data.map((w) => ({ id: w.id, name: w.name })))
      if (!page.has_more || !page.last_id) break
      after = page.last_id
    }
    return tags
  },
  async *costs(config, ctx, from, to) {
    // Hours from yesterday on (for "Cost runaway"), days before; at most 31 days a request.
    const begin = Math.max(from.getTime(), EARLIEST)
    const end = to.getTime()
    const hoursFrom = Math.max(begin, Math.floor((end - DAY) / DAY) * DAY)
    const ranges: [number, number, '1d' | '1h'][] = []
    for (let start = begin; start < hoursFrom; start += 31 * DAY)
      ranges.push([start, Math.min(hoursFrom, start + 31 * DAY), '1d'])
    if (hoursFrom < end) ranges.push([hoursFrom, end, '1h'])
    for (const [start, stop, width] of ranges) {
      const params = new URLSearchParams({
        starting_at: new Date(start).toISOString(),
        ending_at: new Date(stop).toISOString(),
        time_bucket_width: width,
        order_by: 'time',
        order: 'asc',
        limit: '1000',
      })
      params.append('group_by[]', 'workspace_id')
      params.append('group_by[]', 'model')
      let page = ''
      for (let i = 0; i < 100; i++) {
        const body = await get<CostPage>(
          config,
          ctx,
          `/analytics/cost?${params}${page ? `&page=${encodeURIComponent(page)}` : ''}`,
        )
        yield anthropicCosts(body)
        if (!body.has_more || !body.next_page) break
        page = body.next_page
      }
    }
  },
}
