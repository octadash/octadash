import { getJson } from '../money/shared'
import type { IntegrationContext } from '../types'
import type { CostConfig, CostItem, CostProvider, CostTag } from './types'

const BASE = 'https://api.openai.com/v1'

const get = <T>(config: CostConfig, ctx: IntegrationContext, path: string) =>
  getJson<T>(ctx, `${BASE}${path}`, {
    authorization: `Bearer ${config.key}`,
    'user-agent': 'Octadash',
  })

interface CostsPage {
  data: {
    start_time: number
    end_time: number
    results: {
      amount: { value: number; currency: string }
      line_item: string | null
      project_id: string | null
    }[]
  }[]
  has_more: boolean
  next_page: string | null
}

interface ProjectsPage {
  data: { id: string; name: string; status?: string }[]
  has_more: boolean
  last_id?: string | null
}

/** OpenAI's daily cost buckets, one item per project and line item. Amounts come in dollars. */
export function openaiCosts(page: CostsPage): CostItem[] {
  const items: CostItem[] = []
  for (const bucket of page.data) {
    for (const r of bucket.results) {
      const value = Number(r.amount?.value ?? 0)
      if (!value) continue
      items.push({
        at: new Date(bucket.start_time * 1000),
        hours: Math.max(1, Math.round((bucket.end_time - bucket.start_time) / 3600)),
        tag: r.project_id ?? '',
        lineItem: r.line_item ?? '',
        amount: value * 100,
        currency: (r.amount.currency || 'usd').toUpperCase(),
      })
    }
  }
  return items
}

/**
 * OpenAI, read with an admin key (sk-admin-...), which only organization
 * owners can make. The costs endpoint has daily buckets only; read every hour,
 * today's bucket grows and the increase is the hour's spend.
 */
export const openai: CostProvider = {
  id: 'openai',
  name: 'OpenAI',
  kind: 'ai',
  keyPlaceholder: 'sk-admin-...',
  keyHelp: {
    en: 'An admin key reads usage and costs only; Octadash never calls a model with it. Organization owners create it in OpenAI › Settings › Organization › Admin keys. The key is stored encrypted and never comes back to the browser.',
    'pt-BR':
      'Uma chave de admin só lê uso e custos; o Octadash nunca chama um modelo com ela. Donos da organização criam em OpenAI › Settings › Organization › Admin keys. A chave fica guardada criptografada e nunca volta para o navegador.',
  },
  tagName: { en: 'project', 'pt-BR': 'projeto' },
  every: 60,
  async check(config, ctx) {
    if (!config.key.startsWith('sk-admin-'))
      return {
        ok: false,
        message: 'Use an admin key (sk-admin-...); project keys cannot read costs.',
      }
    const start = Math.floor(Date.now() / 1000) - 86_400
    await get(config, ctx, `/organization/costs?start_time=${start}&limit=1`)
    return { ok: true }
  },
  async tags(config, ctx) {
    const tags: CostTag[] = []
    let after = ''
    for (let i = 0; i < 20; i++) {
      const page = await get<ProjectsPage>(
        config,
        ctx,
        `/organization/projects?limit=100&include_archived=true${after ? `&after=${after}` : ''}`,
      )
      tags.push(...page.data.map((p) => ({ id: p.id, name: p.name })))
      if (!page.has_more || !page.last_id) break
      after = page.last_id
    }
    return tags
  },
  async *costs(config, ctx, from, to) {
    const params = new URLSearchParams({
      start_time: String(Math.floor(from.getTime() / 1000)),
      end_time: String(Math.floor(to.getTime() / 1000)),
      bucket_width: '1d',
      limit: '180',
    })
    params.append('group_by', 'project_id')
    params.append('group_by', 'line_item')
    let page = ''
    for (let i = 0; i < 100; i++) {
      const body = await get<CostsPage>(
        config,
        ctx,
        `/organization/costs?${params}${page ? `&page=${encodeURIComponent(page)}` : ''}`,
      )
      yield openaiCosts(body)
      if (!body.has_more || !body.next_page) return
      page = body.next_page
    }
  },
}
