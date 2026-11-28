import {
  compileLogQuery,
  listGroups,
  listOpenIncidents,
  listOrgMonitors,
  listProjects,
  monitorStats,
  parseLogQuery,
  searchLogs,
  trafficBreakdown,
  trafficSummary,
} from '@octadash/db'
import { z } from 'zod'
import type { McpTool } from '@/lib/mcp'
import { services } from './context'

/**
 * The read-only tools of Octadash's MCP server, one set per area. Each takes
 * an optional product slug; without it, every product of the organization.
 * Every step of the roadmap adds its own here.
 */

export interface McpContext {
  orgId: string
}

type Project = Awaited<ReturnType<typeof listProjects>>[number]

const product = z
  .string()
  .optional()
  .describe('Product slug or name, from list_products. Leave out for every product.')

async function productsOf(orgId: string, chosen: string | undefined) {
  const all = await listProjects(services().db, orgId)
  if (!chosen) return { all, scope: all }
  const wanted = chosen.trim().toLowerCase()
  const found = all.find((p) => p.slug === wanted || p.name.toLowerCase() === wanted)
  if (!found) {
    throw new Error(
      `No product "${chosen}". Products: ${all.map((p) => p.slug).join(', ') || 'none yet'}.`,
    )
  }
  return { all, scope: [found] }
}

const slugOf = (all: Project[], id: string) => all.find((p) => p.id === id)?.slug ?? id
const pct = (value: number | null) => (value === null ? null : Math.round(value * 10_000) / 100)

export const MCP_TOOLS: McpTool<McpContext>[] = [
  {
    name: 'list_products',
    title: 'Products and groups',
    description:
      'The products of the organization (slug and name) and the saved groups of products. Other tools take a product slug.',
    input: z.object({}),
    async run(_input, { orgId }) {
      const { db } = services()
      const [projects, groups] = await Promise.all([listProjects(db, orgId), listGroups(db, orgId)])
      return {
        products: projects.map((p) => ({ slug: p.slug, name: p.name })),
        groups: groups.map((g) => ({
          slug: g.slug,
          name: g.name,
          products: g.project_ids.map((id) => slugOf(projects, id)),
        })),
      }
    },
  },
  {
    name: 'uptime_status',
    title: 'Uptime',
    description:
      'Every monitor (website, health endpoint, heartbeat) with its state now, uptime and median response time over the last 24 hours and 30 days, and days left on the certificate.',
    input: z.object({ product }),
    async run(input, { orgId }) {
      const { db, clickhouse } = services()
      const { all, scope } = await productsOf(orgId, input.product as string | undefined)
      const ids = new Set(scope.map((p) => p.id))
      const monitors = (await listOrgMonitors(db, orgId)).filter((m) => ids.has(m.project_id))
      const monitorIds = monitors.map((m) => m.id)
      const [day, month] = await Promise.all([
        monitorStats(clickhouse, orgId, monitorIds, 1),
        monitorStats(clickhouse, orgId, monitorIds, 30),
      ])
      return {
        monitors: monitors.map((m) => ({
          product: slugOf(all, m.project_id),
          name: m.name,
          kind: m.kind,
          url: m.url,
          status: m.paused ? 'paused' : m.status,
          since: m.status_since,
          lastCheck: day.get(m.id)?.lastAt ?? month.get(m.id)?.lastAt ?? null,
          lastError: day.get(m.id)?.lastError ?? null,
          uptime24hPercent: pct(day.get(m.id)?.uptime ?? null),
          uptime30dPercent: pct(month.get(m.id)?.uptime ?? null),
          medianMs24h: day.get(m.id)?.medianMs ?? null,
          certificateDaysLeft: month.get(m.id)?.certDays ?? null,
        })),
      }
    },
  },
  {
    name: 'open_emergencies',
    title: 'Open emergencies and signals',
    description:
      'What is open right now: emergencies (a site down, a missed heartbeat, an error spike, a key event that stopped, failing payments, runaway costs) and signals, with when each started and whether someone is on it.',
    input: z.object({ product }),
    async run(input, { orgId }) {
      const { db } = services()
      const { scope } = await productsOf(orgId, input.product as string | undefined)
      const ids = new Set(scope.map((p) => p.id))
      const open = (await listOpenIncidents(db, orgId)).filter((i) => ids.has(i.project_id))
      return {
        open: open.map((i) => ({
          product: i.project_slug,
          kind: i.kind,
          level: i.level,
          startedAt: i.started_at,
          onIt: i.acknowledged_at !== null,
          details: i.data,
        })),
      }
    },
  },
  {
    name: 'traffic',
    title: 'Traffic',
    description:
      'Visitors and page views over the last days, against the days before, with the top pages, sources, channels and countries. Bots are counted apart.',
    input: z.object({
      product,
      days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .default(7)
        .describe('How many days back, 7 by default.'),
      top: z.number().int().min(1).max(50).default(10).describe('Rows per list, 10 by default.'),
    }),
    async run(input, { orgId }) {
      const { clickhouse } = services()
      const { all, scope: chosen } = await productsOf(orgId, input.product as string | undefined)
      const days = Number(input.days)
      const top = Number(input.top)
      const to = new Date()
      const from = new Date(to.getTime() - days * 86_400_000)
      const before = new Date(from.getTime() - days * 86_400_000)
      const scope = { orgId, projectIds: chosen.map((p) => p.id), from, to }
      const [now, previous, pages, sources, channels, countries, products] = await Promise.all([
        trafficSummary(clickhouse, scope),
        trafficSummary(clickhouse, { ...scope, from: before, to: from }),
        trafficBreakdown(clickhouse, scope, 'page', top),
        trafficBreakdown(clickhouse, scope, 'source', top),
        trafficBreakdown(clickhouse, scope, 'channel', top),
        trafficBreakdown(clickhouse, scope, 'country', top),
        chosen.length > 1 ? trafficBreakdown(clickhouse, scope, 'product', top) : [],
      ])
      const rows = (list: { value: string; visitors: number; pageviews: number }[]) =>
        list.map((r) => ({
          value: r.value || '(none)',
          visitors: r.visitors,
          pageviews: r.pageviews,
        }))
      return {
        period: { from, to, days },
        visitors: now.visitors,
        pageviews: now.pageviews,
        bots: now.bots,
        previousPeriod: { visitors: previous.visitors, pageviews: previous.pageviews },
        topPages: rows(pages),
        topSources: rows(sources),
        channels: rows(channels),
        countries: rows(countries),
        ...(products.length > 0
          ? {
              byProduct: products.map((r) => ({
                product: slugOf(all, r.value),
                visitors: r.visitors,
                pageviews: r.pageviews,
              })),
            }
          : {}),
      }
    },
  },
  {
    name: 'search_logs',
    title: 'Search logs',
    description:
      'Log lines, newest first, with the same search the Logs page takes: words, "exact phrases", level:error, service:api, any attribute as key:value, and - to exclude. Personal data was already masked when the line arrived.',
    input: z.object({
      product,
      query: z.string().max(500).default('').describe('The search, such as: level:error timeout'),
      minutes: z
        .number()
        .int()
        .min(1)
        .max(10_080)
        .default(60)
        .describe('How far back, in minutes. 60 by default, up to 7 days.'),
      limit: z.number().int().min(1).max(200).default(50).describe('Most lines, 50 by default.'),
    }),
    async run(input, { orgId }) {
      const { clickhouse } = services()
      const { all, scope } = await productsOf(orgId, input.product as string | undefined)
      const to = new Date()
      const from = new Date(to.getTime() - Number(input.minutes) * 60_000)
      const query = compileLogQuery(
        parseLogQuery(String(input.query)),
        new Map(all.map((p) => [p.slug, p.id])),
      )
      const lines = await searchLogs(
        clickhouse,
        { orgId, projectIds: scope.map((p) => p.id), from, to },
        query,
        { limit: Number(input.limit) },
      )
      return {
        period: { from, to },
        lines: lines.map((l) => ({
          product: slugOf(all, l.projectId),
          at: l.timestamp,
          level: l.level,
          service: l.service,
          body: l.body,
          ...(l.traceId ? { traceId: l.traceId } : {}),
          attributes: l.attributes,
        })),
      }
    },
  },
]
