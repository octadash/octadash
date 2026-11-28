import {
  aiModelUse,
  allows,
  compileLogQuery,
  createProject,
  createSource,
  currencyDigits,
  getIssue,
  hasPageScript,
  issueEvent,
  issueStats,
  listGroups,
  listIssues,
  listKeyEvents,
  listOpenIncidents,
  listOrgMonitors,
  listProjects,
  listSources,
  monitorStats,
  parseLogQuery,
  SIGNUP_EVENTS,
  searchLogs,
  sentryDsn,
  signupsByProduct,
  sourcesLastData,
  type TokenResource,
  type TokenScopes,
  trafficBreakdown,
  trafficSummary,
  usageEvents,
  usageTotals,
} from '@octadash/db'
import { AI_PRICES_DATE } from '@octadash/integrations'
import {
  errorSnippet,
  isErrorPlatform,
  isTrafficPlatform,
  LOG_SOURCE_PLATFORMS,
  logSnippet,
  logTabOf,
  tabOf,
  trafficSnippet,
  usageSnippet,
} from '@octadash/snippets'
import { z } from 'zod'
import type { McpTool } from '@/lib/mcp'
import { SOURCE_PLATFORMS } from '@/lib/sources'
import { services } from './context'
import { loadCosts } from './costs'
import { loadMoney } from './money'

/**
 * The tools of Octadash's MCP server, one set per area. Each reading tool
 * takes an optional product slug; without it, every product of the
 * organization. Every step of the roadmap adds its own here. The setup tools
 * (`writes`) only add a product or a source and read install code, for a
 * coding assistant putting Octadash in a project; only a setup token sees them.
 */

export interface McpContext {
  orgId: string
}

/** A tool with the scopes it needs: a token sees it only when it has them all. */
type Tool = McpTool<McpContext> & {
  needs: [TokenResource, 'read' | 'write' | 'delete'][]
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
/** Already in percent, to one decimal. */
const oneDecimal = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10)
const pct = (value: number | null) => (value === null ? null : Math.round(value * 10_000) / 100)

export const MCP_TOOLS: Tool[] = [
  {
    name: 'list_products',
    needs: [['products', 'read']],
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
    needs: [['monitors', 'read']],
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
    needs: [['alerts', 'read']],
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
    needs: [['traffic', 'read']],
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
    name: 'usage',
    needs: [['usage', 'read']],
    title: 'Product usage',
    description:
      'What people do in the product over the last days, against the days before: active people, sign-ups and key events, the top events with how many people did each, and any open "Sign-ups dropped" signal (sign-ups in the last 24 hours well under what is expected). Page views and bots are left out.',
    input: z.object({
      product,
      days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .default(7)
        .describe('How many days back, 7 by default.'),
      top: z.number().int().min(1).max(100).default(20).describe('Events listed, 20 by default.'),
    }),
    async run(input, { orgId }) {
      const { db, clickhouse } = services()
      const { all, scope: chosen } = await productsOf(orgId, input.product as string | undefined)
      const days = Number(input.days)
      const to = new Date()
      const from = new Date(to.getTime() - days * 86_400_000)
      const previous = { from: new Date(from.getTime() - days * 86_400_000), to: from }
      const ids = chosen.map((p) => p.id)
      const scope = { orgId, projectIds: ids, from, to }
      const keys = await listKeyEvents(db, orgId, ids)
      const refs = keys.map((k) => ({ projectId: k.projectId, event: k.event }))
      const [now, before, events, signups, incidents] = await Promise.all([
        usageTotals(clickhouse, scope, SIGNUP_EVENTS, refs),
        usageTotals(clickhouse, { ...scope, ...previous }, SIGNUP_EVENTS, refs),
        usageEvents(clickhouse, scope, [previous], Number(input.top)),
        chosen.length > 1 ? signupsByProduct(clickhouse, scope, SIGNUP_EVENTS) : new Map(),
        listOpenIncidents(db, orgId),
      ])
      const isKey = new Set(keys.map((k) => `${k.projectId}:${k.event}`))
      return {
        period: { from, to, days },
        activePeople: now.active,
        signups: now.signups,
        keyEvents: now.keyEvents,
        previousPeriod: {
          activePeople: before.active,
          signups: before.signups,
          keyEvents: before.keyEvents,
        },
        signupEvents: SIGNUP_EVENTS,
        markedKeyEvents: keys.map((k) => ({ product: slugOf(all, k.projectId), event: k.event })),
        topEvents: events.map((e) => ({
          ...(chosen.length > 1 ? { product: slugOf(all, e.projectId) } : {}),
          event: e.event,
          count: e.count,
          people: e.people,
          previousPeriod: e.baseline[0] ?? 0,
          key: isKey.has(`${e.projectId}:${e.event}`),
          last: e.last,
        })),
        ...(signups.size > 0
          ? {
              signupsByProduct: [...signups].map(([id, count]) => ({
                product: slugOf(all, id),
                signups: count,
              })),
            }
          : {}),
        signals: incidents
          .filter((i) => i.kind === 'signups_dropped' && ids.includes(i.project_id))
          .map((i) => {
            const d = (i.data ?? {}) as Record<string, unknown>
            return {
              product: i.project_slug,
              since: i.started_at,
              last24h: d.count,
              expected: d.expected,
              percentUnder: d.percent,
            }
          }),
      }
    },
  },
  {
    name: 'search_logs',
    needs: [['logs', 'read']],
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
  {
    name: 'list_issues',
    needs: [['errors', 'read']],
    title: 'Error issues',
    description:
      'Error issues (events grouped by where they happen), most recently seen first, with how many events and people each had in the period. Use issue_details for the stack trace of one.',
    input: z.object({
      product,
      status: z
        .enum(['unresolved', 'new', 'regressed', 'resolved', 'ignored'])
        .default('unresolved')
        .describe(
          'unresolved by default; new = began in the period; regressed = came back after resolved.',
        ),
      hours: z
        .number()
        .int()
        .min(1)
        .max(720)
        .default(24)
        .describe('The period for event counts (and for "new"), in hours. 24 by default.'),
      limit: z.number().int().min(1).max(100).default(25).describe('Most issues, 25 by default.'),
    }),
    async run(input, { orgId }) {
      const { db, clickhouse, env } = services()
      const { all, scope } = await productsOf(orgId, input.product as string | undefined)
      const to = new Date()
      const from = new Date(to.getTime() - Number(input.hours) * 3_600_000)
      const projectIds = scope.map((p) => p.id)
      const [issues, stats] = await Promise.all([
        listIssues(db, orgId, {
          projectIds,
          tab: input.status as 'unresolved',
          since: from,
          userId: '',
          limit: Number(input.limit),
        }),
        issueStats(clickhouse, { orgId, projectIds, from, to }, 1).catch(
          () => new Map<string, { events: number; people: number }>(),
        ),
      ])
      return {
        period: { from, to },
        issues: issues.map((issue) => {
          const slug = slugOf(all, issue.project_id)
          return {
            id: issue.id,
            product: slug,
            type: issue.type,
            message: issue.value,
            culprit: issue.culprit,
            level: issue.level,
            handled: issue.handled,
            status: issue.status,
            firstSeen: issue.first_seen,
            lastSeen: issue.last_seen,
            timesSeen: issue.times_seen,
            eventsInPeriod: stats.get(issue.id)?.events ?? 0,
            peopleInPeriod: stats.get(issue.id)?.people ?? 0,
            ...(issue.regressed_at ? { regressedAt: issue.regressed_at } : {}),
            ...(issue.last_release ? { lastRelease: issue.last_release } : {}),
            url: `${panelUrl(env.OCTADASH_URL)}/p/${slug}/errors/${issue.id}`,
          }
        }),
      }
    },
  },
  {
    name: 'issue_details',
    needs: [['errors', 'read']],
    title: 'One error issue',
    description:
      'One issue with its newest event: the exception chain with the stack trace (the app’s own frames marked inApp), the last breadcrumbs, tags, release, environment, page and browser. Personal data was already masked when the event arrived.',
    input: z.object({
      issue: z.string().uuid().describe('The issue id, from list_issues.'),
    }),
    async run(input, { orgId }) {
      const { db, clickhouse, env } = services()
      const issue = await getIssue(db, orgId, String(input.issue))
      if (!issue) throw new Error('No such issue in this organization.')
      const { all } = await productsOf(orgId, undefined)
      const event = await issueEvent(clickhouse, orgId, issue.id)
      const slug = slugOf(all, issue.project_id)
      return {
        id: issue.id,
        product: slug,
        type: issue.type,
        message: issue.value,
        culprit: issue.culprit,
        level: issue.level,
        handled: issue.handled,
        status: issue.status,
        firstSeen: issue.first_seen,
        lastSeen: issue.last_seen,
        timesSeen: issue.times_seen,
        firstRelease: issue.first_release,
        lastRelease: issue.last_release,
        url: `${panelUrl(env.OCTADASH_URL)}/p/${slug}/errors/${issue.id}`,
        latestEvent: event && {
          id: event.event_id,
          at: event.timestamp,
          release: event.release,
          environment: event.environment,
          platform: event.platform,
          sdk: event.sdk,
          url: event.url,
          browser: event.browser,
          os: event.os,
          traceId: event.trace_id || undefined,
          exceptions: event.exception.map((e) => ({
            type: e.type,
            value: e.value,
            handled: e.mechanism?.handled,
            // Innermost frames last, as SDKs send them; the last 40 are where it broke.
            frames: e.frames.slice(-40).map((f) => ({
              function: f.function,
              file: f.filename || f.module,
              line: f.lineno,
              column: f.colno,
              inApp: f.in_app,
              ...(f.context_line ? { code: f.context_line.trim() } : {}),
            })),
          })),
          breadcrumbs: event.breadcrumbs.slice(-20).map((b) => ({
            at: b.timestamp ? new Date(b.timestamp).toISOString() : undefined,
            category: b.category,
            level: b.level,
            message: b.message,
          })),
          tags: event.tags,
        },
      }
    },
  },
  {
    name: 'money',
    needs: [['money', 'read']],
    title: 'Money',
    description:
      'Revenue, MRR, new subscriptions, churn and failed charges for a period, against the period before, per product and with the latest payments. Amounts are in the organization currency, converted at each day rate.',
    input: z.object({
      product,
      period: z
        .enum(['today', '24h', '7d', '30d'])
        .default('30d')
        .describe('today, 24h, 7d or 30d (default).'),
    }),
    async run(input, { orgId }) {
      const { scope } = await productsOf(orgId, input.product as string | undefined)
      const data = await loadMoney(orgId, input.product ? scope.map((p) => p.id) : null, {
        period: input.period as '30d',
        metric: 'revenue',
      })
      const major = (minor: number) => minor / 10 ** currencyDigits(data.currency)
      const share = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10)
      return {
        currency: data.currency,
        period: { from: data.period.from, to: data.period.to },
        productsWithGateway: data.connected,
        totals: {
          revenue: major(data.totals.revenue),
          oneOffRevenue: major(data.totals.oneOffRevenue),
          refunded: major(data.totals.refunded),
          mrr: major(data.totals.mrr),
          newSubscriptions: data.totals.started,
          churnPercent: share(data.totals.churn),
          failedChargesPercent: share(data.totals.failed),
          buyers: data.totals.buyers,
          returningBuyers: data.totals.returning,
        },
        previous: {
          revenue: major(data.previous.revenue),
          mrr: major(data.previous.mrr),
          newSubscriptions: data.previous.started,
        },
        ...(data.failingNow
          ? { failingNow: { product: data.failingNow.name, percent: share(data.failingNow.share) } }
          : {}),
        byProduct: data.byProduct.map((p) => ({
          product: p.project.slug,
          gateway: p.connected,
          revenue: major(p.revenue),
          mrr: major(p.mrr),
          mrrChangePercent: p.mrrChange,
          today: major(p.today),
          paying: p.paying,
          churnPercent: share(p.churn),
          failedNowPercent: share(p.failedNow),
        })),
        latestPayments: data.latest.slice(0, 10).map((pay) => ({
          product: pay.product.slug,
          at: pay.at,
          status: pay.status,
          amount: pay.amount / 10 ** currencyDigits(pay.currency),
          currency: pay.currency,
          gateway: pay.gateway,
          subscription: pay.subscription,
          ...(pay.failure ? { failure: pay.failure } : {}),
        })),
        ...(data.unconverted.length > 0 ? { leftOutNoRate: data.unconverted } : {}),
        ...(data.complete ? {} : { partial: true }),
      }
    },
  },
  {
    name: 'costs',
    needs: [['costs', 'read']],
    title: 'Costs and margin',
    description:
      'What the products cost (AI providers and fixed bills, split between products), revenue and margin for a period against the period before, this month forecast against budgets, and AI spend today against its average. Amounts in the organization currency.',
    input: z.object({
      product,
      period: z
        .enum(['month', '7d', '30d'])
        .default('month')
        .describe('month (this calendar month, default), 7d or 30d.'),
    }),
    async run(input, { orgId }) {
      const { scope } = await productsOf(orgId, input.product as string | undefined)
      const data = await loadCosts(orgId, input.product ? scope.map((p) => p.id) : null, {
        period: input.period as 'month',
      })
      const major = (minor: number) => minor / 10 ** currencyDigits(data.currency)
      return {
        currency: data.currency,
        period: { from: data.period.from, to: data.period.to },
        totals: {
          spend: major(data.totals.spend),
          revenue: major(data.totals.revenue),
          marginPercent: oneDecimal(data.totals.margin),
        },
        previous: {
          spend: major(data.previous.spend),
          marginPercent: oneDecimal(data.previous.margin),
        },
        month: {
          spent: major(data.month.spent),
          forecast: major(data.month.forecast),
          ...(data.month.budget
            ? {
                budget: major(data.month.budget.amount),
                budgetForecast: major(data.month.budget.forecast),
              }
            : {}),
        },
        aiToday: {
          spend: major(data.ai.today),
          dailyAverage: major(data.ai.average),
          ...(data.ai.top ? { furthestAbove: data.ai.top } : {}),
        },
        byProduct: data.byProduct.map((p) => ({
          product: p.project.slug,
          cost: major(p.cost),
          revenue: major(p.revenue),
          marginPercent: oneDecimal(p.margin),
          ...(p.aiTimes ? { aiTodayTimesAverage: p.aiTimes } : {}),
          ...(p.budget ? { budget: p.budget } : {}),
        })),
        byProvider: data.byProvider.map((c) => ({
          name: c.name,
          provider: c.provider,
          amount: major(c.amount),
          unassigned: major(c.unassigned),
          status: c.status,
          syncedAt: c.syncedAt,
        })),
        ...(data.unconverted.length > 0 ? { leftOutNoRate: data.unconverted } : {}),
        ...(data.complete ? {} : { partial: true }),
      }
    },
  },
  {
    name: 'ai_usage',
    needs: [['costs', 'read']],
    title: 'AI calls',
    description:
      'Model calls the products reported themselves (OpenTelemetry gen_ai spans, PostHog AI events) over the last days: per product and model, the calls, failures, input, output and cached tokens, and the cost in US dollars at list price unless the app sent its own. Apart from the bills of connected AI accounts, which the costs tool reads.',
    input: z.object({
      product,
      days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .default(7)
        .describe('How many days back, 7 by default.'),
    }),
    async run(input, { orgId }) {
      const { clickhouse } = services()
      const { all, scope: chosen } = await productsOf(orgId, input.product as string | undefined)
      const days = Number(input.days)
      const to = new Date()
      const from = new Date(to.getTime() - days * 86_400_000)
      const rows = await aiModelUse(clickhouse, {
        orgId,
        projectIds: chosen.map((p) => p.id),
        from,
        to,
      })
      const usd = (value: number) => Math.round(value * 10_000) / 10_000
      return {
        period: { from, to, days },
        pricesFrom: `LiteLLM price list of ${AI_PRICES_DATE}`,
        calls: rows.reduce((n, r) => n + r.calls, 0),
        costUsd: usd(rows.reduce((n, r) => n + r.cost, 0)),
        models: rows.map((r) => ({
          product: slugOf(all, r.projectId),
          provider: r.provider,
          model: r.model,
          calls: r.calls,
          failed: r.errors,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          cachedInputTokens: r.cacheReadTokens,
          costUsd: usd(r.cost),
          callsWithoutPrice: r.unpriced,
        })),
      }
    },
  },
  {
    name: 'list_sources',
    needs: [['sources', 'read']],
    title: 'Sources and their data',
    description:
      'The sources of one product (each app, site or server that sends data), with where it runs, the areas it feeds and when it last sent each kind of data in the last 30 days. Use it to check that the first data arrived after installing.',
    input: z.object({
      product: z.string().describe('Product slug or name, from list_products.'),
    }),
    async run(input, { orgId }) {
      const { db, clickhouse } = services()
      const project = await oneProduct(orgId, String(input.product))
      const now = new Date()
      const [sources, last] = await Promise.all([
        listSources(db, orgId, project.id),
        sourcesLastData(clickhouse, orgId, [project.id], new Date(now.getTime() - 30 * 86_400_000)),
      ])
      return {
        product: project.slug,
        sources: sources.map((s) => {
          const seen = last.get(s.id)
          return {
            id: s.id,
            name: s.name,
            platform: s.platform,
            areas: s.areas,
            lastData: seen
              ? {
                  any: seen.any,
                  pageview: seen.pageview ?? null,
                  event: seen.event ?? null,
                  error: seen.error ?? null,
                  log: seen.log ?? null,
                }
              : null,
          }
        }),
      }
    },
  },
  {
    name: 'create_product',
    needs: [['products', 'write']],
    title: 'Create a product',
    description:
      'Creates a product by name, or returns the one with that name if it exists (existed: true). A product is one thing you sell or run (a SaaS, a site) and holds its sources.',
    input: z.object({
      name: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .describe('The product name people know, such as "Pagebird".'),
    }),
    writes: true,
    async run(input, { orgId }) {
      const { db, env } = services()
      const name = String(input.name).trim()
      const all = await listProjects(db, orgId)
      const found = all.find((p) => p.name.toLowerCase() === name.toLowerCase())
      const project = found ?? (await createProject(db, orgId, { name }))
      return {
        existed: Boolean(found),
        slug: project.slug,
        name: project.name,
        url: `${panelUrl(env.OCTADASH_URL)}/p/${project.slug}`,
      }
    },
  },
  {
    name: 'create_source',
    needs: [['sources', 'write']],
    title: 'Add a source',
    description:
      'Adds a source to a product: one app, site or server that sends data, with its own key. Returns the existing one when the product already has a source with that name (existed: true). Then call source_setup for its key and code.',
    input: z.object({
      product: z.string().describe('Product slug or name, from list_products or create_product.'),
      name: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .describe('What it is, so people tell sources apart: "Site", "App", "API", "Worker".'),
      platform: z
        .enum(SOURCE_PLATFORMS)
        .describe(
          'Where its code runs. html (any page), nextjs, react (any browser app built with a bundler), wordpress, gtm (Google Tag Manager), node, python, dotnet, java, go, php, ruby, mobile, other.',
        ),
    }),
    writes: true,
    async run(input, { orgId }) {
      const { db } = services()
      const project = await oneProduct(orgId, String(input.product))
      const name = String(input.name).trim()
      const existing = (await listSources(db, orgId, project.id)).find(
        (s) => s.name.toLowerCase() === name.toLowerCase(),
      )
      const source =
        existing ??
        (await createSource(db, orgId, project.id, {
          name,
          platform: String(input.platform),
          areas: [],
        }))
      if (!source) throw new Error(`No product "${String(input.product)}".`)
      return {
        existed: Boolean(existing),
        product: project.slug,
        source: { id: source.id, name: source.name, platform: source.platform },
      }
    },
  },
  {
    name: 'source_setup',
    needs: [
      ['sources', 'read'],
      ['keys', 'read'],
    ],
    title: 'Install code of a source',
    description:
      "The source's public key and the exact code to install, per area it can feed: traffic (page script), errors (Sentry SDK with the DSN, or the page script), usage (track and identify), logs (OpenTelemetry). Public keys are meant to ship in client code; keep them in environment variables anyway.",
    input: z.object({
      product: z.string().describe('Product slug or name.'),
      source: z.string().describe('Source id or name, from create_source or list_sources.'),
    }),
    async run(input, { orgId }) {
      const { db, env } = services()
      const project = await oneProduct(orgId, String(input.product))
      const wanted = String(input.source).trim().toLowerCase()
      const sources = await listSources(db, orgId, project.id)
      const source = sources.find((s) => s.id === wanted || s.name.toLowerCase() === wanted)
      if (!source) {
        throw new Error(
          `No source "${String(input.source)}" in ${project.slug}. Sources: ${sources.map((s) => s.name).join(', ') || 'none yet'}.`,
        )
      }
      if (!source.public_key)
        throw new Error('This source has no working key. Rotate it in the panel.')
      const ingestUrl = env.OCTADASH_INGEST_URL.replace(/\/+$/, '')
      const publicKey = source.public_key
      const dsn = sentryDsn(ingestUrl, publicKey, String(project.ingest_id))
      const platform = source.platform
      const browser = isTrafficPlatform(platform) && platform !== 'other'
      const docs = 'https://docs.octadash.com/send-data'
      return {
        product: project.slug,
        source: { id: source.id, name: source.name, platform },
        ingestUrl,
        publicKey,
        dsn,
        env: { OCTADASH_KEY: publicKey, OCTADASH_HOST: ingestUrl, SENTRY_DSN: dsn },
        code: {
          ...(browser
            ? {
                traffic: {
                  ...trafficSnippet(platform, {
                    ingestUrl,
                    publicKey,
                    persistent: source.visitor_mode === 'persistent',
                    local: false,
                  }),
                  docs: `${docs}/traffic`,
                },
              }
            : {}),
          ...(isErrorPlatform(platform)
            ? {
                errors: {
                  ...errorSnippet(platform, { ingestUrl, publicKey, dsn }),
                  docs: `${docs}/errors`,
                },
              }
            : {}),
          usage: {
            ...usageSnippet(tabOf(platform), {
              ingestUrl,
              publicKey,
              hasScript: browser && hasPageScript(platform, ['traffic']),
            }),
            docs: `${docs}/product-usage`,
          },
          ...((LOG_SOURCE_PLATFORMS as readonly string[]).includes(platform)
            ? {
                logs: {
                  ...logSnippet(logTabOf(platform), {
                    ingestUrl,
                    publicKey,
                    service: serviceName(source.name),
                  }),
                  docs: `${docs}/logs`,
                },
              }
            : {}),
        },
        ...(platform === 'node' ? { nodeSdk: `${docs}/node` } : {}),
        check:
          'After installing, open the app once and call list_sources: lastData shows what arrived.',
      }
    },
  },
]

/** One product by slug or name, or an error that lists them. */
async function oneProduct(orgId: string, chosen: string) {
  const { scope } = await productsOf(orgId, chosen || undefined)
  const [project] = scope
  if (!project || scope.length !== 1)
    throw new Error('Name one product: its slug or name, from list_products.')
  return project
}

const panelUrl = (url: string) => url.replace(/\/+$/, '')
const serviceName = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'api'

/** The tools a token sees: those its scopes allow, every need of each. */
export function toolsFor(scopes: TokenScopes): McpTool<McpContext>[] {
  return MCP_TOOLS.filter((tool) =>
    tool.needs.every(([resource, need]) => allows(scopes, resource, need)),
  )
}

export function instructionsFor(scopes: TokenScopes): string {
  const parts = [
    'Questions about the products of one Octadash organization. Start with list_products; the other tools take a product slug, or none for every product. This token sees only the tools its scopes allow.',
  ]
  if (allows(scopes, 'products', 'write') && allows(scopes, 'sources', 'write')) {
    parts.push(
      'To set a product up: create_product, create_source, then source_setup for the key and the exact code to install, and list_sources to check the first data arrived. These tools only add.',
    )
  }
  return parts.join(' ')
}
