import { randomBytes } from 'node:crypto'
import {
  getOrganizationSettings,
  listConnectionProjects,
  listConnections,
  listCostShares,
  listOrgAreas,
  listProjects,
} from '@octadash/db'
import {
  COST_PROVIDERS,
  type CostProvider,
  costProvider,
  MONEY_GATEWAYS,
  moneyGateway,
} from '@octadash/integrations'
import { getLocale } from 'next-intl/server'
import type { CostProviderChoice } from '@/components/cost-connect-form'
import type { GatewayChoice } from '@/components/money-connect-form'
import { services } from './context'

/**
 * Where a product stands on an area fed by accounts (Money, Costs) or by
 * monitors (Uptime): it has one, another product's account could serve it
 * too, nothing yet, or marked as not used.
 */
export type ConnectionState = 'sending' | 'canUse' | 'none' | 'dismissed'

/** An account another product uses, that this one could share. */
export interface SharedAccount {
  id: string
  /** "Stripe · Main account", or the name alone when it is the provider's. */
  name: string
  /** The products it serves. */
  products: string[]
}

export interface ProductConnectionSetup {
  product: { id: string; name: string; slug: string }
  state: ConnectionState
  shared: SharedAccount[]
}

const ORDER: Record<ConnectionState, number> = { sending: 0, canUse: 1, none: 2, dismissed: 3 }

/** Each product of the scope on Money or Costs, quickest to finish first. */
export async function loadConnectionSetup(
  orgId: string,
  projects: { id: string; name: string; slug: string }[],
  area: 'money' | 'costs',
): Promise<ProductConnectionSetup[]> {
  const { db } = services()
  const [connections, links, shares, all, areas] = await Promise.all([
    listConnections(db, orgId),
    area === 'money' ? listConnectionProjects(db, orgId) : Promise.resolve([]),
    area === 'costs' ? listCostShares(db, orgId) : Promise.resolve([]),
    listProjects(db, orgId),
    listOrgAreas(db, orgId),
  ])
  const names = new Map(all.map((p) => [p.id, p.name]))
  const served = (area === 'money' ? links : shares).map((l) => ({
    connectionId: l.connectionId,
    projectId: l.projectId,
  }))
  const accounts = connections.flatMap((c) => {
    const provider =
      area === 'money'
        ? moneyGateway(c.integration)
        : (costProvider(c.integration) ?? (c.integration === 'fixed' ? null : undefined))
    if (provider === undefined) return []
    return [
      {
        id: c.id,
        name: provider && c.name !== provider.name ? `${provider.name} · ${c.name}` : c.name,
        projectIds: served.filter((s) => s.connectionId === c.id).map((s) => s.projectId),
      },
    ]
  })
  return projects
    .map((p) => {
      const shared = accounts
        .filter((a) => a.projectIds.length > 0 && !a.projectIds.includes(p.id))
        .map((a) => ({
          id: a.id,
          name: a.name,
          products: a.projectIds.map((id) => names.get(id) ?? ''),
        }))
      const state: ConnectionState = accounts.some((a) => a.projectIds.includes(p.id))
        ? 'sending'
        : areas.get(p.id)?.get(area) === 'dismissed'
          ? 'dismissed'
          : shared.length > 0
            ? 'canUse'
            : 'none'
      return { product: { id: p.id, name: p.name, slug: p.slug }, state, shared }
    })
    .sort((a, b) => ORDER[a.state] - ORDER[b.state])
}

/** Products with no monitor, each marked as not using Uptime or not. */
export async function loadUptimeSetup(
  orgId: string,
  projects: { id: string; name: string; slug: string }[],
): Promise<ProductConnectionSetup[]> {
  const areas = await listOrgAreas(services().db, orgId)
  return projects
    .map((p) => ({
      product: { id: p.id, name: p.name, slug: p.slug },
      state: (areas.get(p.id)?.get('uptime') === 'dismissed'
        ? 'dismissed'
        : 'none') as ConnectionState,
      shared: [],
    }))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state])
}

/** What the Money connect form needs, made on the page. */
export async function moneyConnectProps(slug: string, product: string) {
  const [locale, env] = [await getLocale(), services().env]
  const gateways: GatewayChoice[] = MONEY_GATEWAYS.map((g) => ({
    id: g.id,
    name: g.name,
    keyPlaceholder: g.keyPlaceholder,
    keyHelp: locale === 'pt-BR' ? g.keyHelp['pt-BR'] : g.keyHelp.en,
    hasProducts: g.hasProducts,
  }))
  return {
    slug,
    product,
    gateways,
    token: randomBytes(16).toString('hex'),
    asaasToken: randomBytes(16).toString('hex'),
    hooksUrl: `${env.OCTADASH_URL.replace(/\/$/, '')}/hooks`,
  }
}

/** "OpenAI project", "projeto da OpenAI". */
export function costTagLabel(p: CostProvider, locale: string) {
  return locale === 'pt-BR' ? `${p.tagName['pt-BR']} da ${p.name}` : `${p.name} ${p.tagName.en}`
}

/** What the Costs connect form needs, in the organization's currency and day. */
export async function costConnectProps(orgId: string, slug: string, product: string) {
  const [locale, settings] = await Promise.all([
    getLocale(),
    getOrganizationSettings(services().db, orgId),
  ])
  const providers: CostProviderChoice[] = COST_PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    keyPlaceholder: p.keyPlaceholder,
    keyHelp: locale === 'pt-BR' ? p.keyHelp['pt-BR'] : p.keyHelp.en,
    tagName: costTagLabel(p, locale),
  }))
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: settings.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return { slug, product, providers, currency: settings.currency, today }
}
