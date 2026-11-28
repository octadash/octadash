'use server'

import { randomUUID } from 'node:crypto'
import { encryptSecret } from '@octadash/core'
import {
  type ConnectionRule,
  createConnection,
  deleteConnection,
  deleteConnectionData,
  getConnection,
  getProjectBySlug,
  listConnectionProjects,
  markConnection,
  removeConnectionProject,
  setConnectionProject,
  setProjectArea,
  updateConnection,
} from '@octadash/db'
import { type GatewayProduct, type MoneyConfig, moneyGateway } from '@octadash/integrations'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { FormState } from '@/components/action-form'
import { isWebhookToken } from '@/lib/money'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

async function productOf(slug: unknown) {
  const { org } = await requireManager()
  if (typeof slug !== 'string' || !slug) return null
  const project = await getProjectBySlug(services().db, org.id, slug)
  return project ? { org, project } : null
}

const text = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value.trim() : '')

/** All, Only these products or By metadata, from the form. Null when a list is empty. */
function ruleOf(formData: FormData): ConnectionRule | null {
  const mode = formData.get('mode')
  if (mode === 'all') return { mode: 'all' }
  if (mode === 'products') {
    // Ticked from "Test key", or typed as ids separated by commas.
    const values = [
      ...formData.getAll('product').map(text),
      ...text(formData.get('productIds')).split(','),
    ]
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 200)
    return values.length > 0 ? { mode: 'products', values } : null
  }
  if (mode === 'metadata') {
    const values = text(formData.get('tags'))
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .slice(0, 50)
    return values.length > 0 ? { mode: 'metadata', values } : null
  }
  return null
}

function sameRule(a: ConnectionRule, b: ConnectionRule) {
  if (a.mode !== b.mode) return false
  if (a.mode === 'all' || b.mode === 'all') return true
  return [...a.values].sort().join('\n') === [...b.values].sort().join('\n')
}

/** Reads the gateway with the key, so a wrong key is told now and not at the first import. */
async function checkKey(gatewayId: string, config: MoneyConfig) {
  const gateway = moneyGateway(gatewayId)
  if (!gateway) return { ok: false, message: 'unknown gateway' }
  try {
    return await gateway.check(config, { fetch, signal: AbortSignal.timeout(15_000) })
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Two products of one account both taking "All of this account" would split
 * nothing: the first would get every payment. The second must pick products
 * or metadata; the "All" one then keeps what the others don't claim.
 */
async function allTakenBy(orgId: string, connectionId: string, projectId: string) {
  const { db } = services()
  const other = (await listConnectionProjects(db, orgId)).find(
    (p) => p.connectionId === connectionId && p.projectId !== projectId && p.rule.mode === 'all',
  )
  if (!other) return null
  const found = await db
    .selectFrom('project')
    .select('name')
    .where('id', '=', other.projectId)
    .executeTakeFirst()
  return found?.name ?? ''
}

/**
 * Reads the connection again from the start (12 months), so stored payments
 * follow the rules as they are now. With `clear`, what was stored goes first:
 * needed when a payment can stop matching any product (a narrower rule, a
 * product leaving), since an unmatched payment is not stored and would keep
 * its old product. The product's numbers fill again in a few minutes.
 */
async function readAgain(orgId: string, connectionId: string, clear: boolean) {
  const { db, clickhouse } = services()
  if (clear) await deleteConnectionData(clickhouse, orgId, connectionId)
  await markConnection(db, connectionId, { status: 'importing', importedAt: null })
}

export interface KeyTest {
  ok: boolean
  message?: string
  products: GatewayProduct[]
}

/** "Test key": reads the gateway and lists its products for "Only these products". */
export async function testMoneyKeyAction(input: {
  slug: string
  gateway: string
  key: string
}): Promise<KeyTest> {
  const t = await getTranslations('moneySetup')
  if (!(await productOf(input.slug)))
    return { ok: false, message: t('errors.notFound'), products: [] }
  const gateway = moneyGateway(input.gateway)
  const key = input.key.trim()
  if (!gateway || !key) return { ok: false, message: t('errors.noKey'), products: [] }
  const result = await checkKey(gateway.id, { key })
  if (!result.ok) return { ok: false, message: result.message, products: [] }
  if (!gateway.hasProducts) return { ok: true, products: [] }
  try {
    const products = await gateway.products({ key }, { fetch, signal: AbortSignal.timeout(15_000) })
    return { ok: true, products: products.slice(0, 200) }
  } catch (err) {
    return { ok: true, message: err instanceof Error ? err.message : String(err), products: [] }
  }
}

/** "Connect and import": a new connection for this product; the worker imports 12 months. */
export async function connectMoneyAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('moneySetup')
  const found = await productOf(formData.get('slug'))
  if (!found) return { error: t('errors.notFound') }
  const gateway = moneyGateway(text(formData.get('gateway')))
  if (!gateway) return { error: t('errors.gateway') }
  const key = text(formData.get('key'))
  if (!key) return { error: t('errors.noKey') }
  const token = text(formData.get('token'))
  if (!isWebhookToken(token)) return { error: t('errors.notFound') }
  const webhookSecret = text(formData.get('webhookSecret'))
  const rule = ruleOf(formData)
  if (!rule) return { error: t('errors.rule') }
  const name = text(formData.get('name')).slice(0, 80) || gateway.name

  const result = await checkKey(gateway.id, { key })
  if (!result.ok) return { error: t('errors.key', { message: result.message ?? '' }) }

  const { db, env } = services()
  const secrets: Record<string, string> = { key: encryptSecret(key, env.OCTADASH_SECRET) }
  if (webhookSecret) secrets.webhookSecret = encryptSecret(webhookSecret, env.OCTADASH_SECRET)
  const connection = await createConnection(db, found.org.id, randomUUID(), {
    integration: gateway.id,
    name,
    secrets: JSON.stringify(secrets),
    keyHint: key.slice(-4),
    webhookToken: token,
  })
  await setConnectionProject(db, found.org.id, connection.id, found.project.id, rule)
  await setProjectArea(db, found.org.id, found.project.id, 'money', 'set_up')
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  redirect(`/p/${found.project.slug}/money/setup`)
}

/**
 * "Use it here too" and "Save" on a connection's rule: this product takes its
 * payments from the connection by the rule. The connection is read again from
 * the start, so payments already stored move to the product they now belong to.
 * A changed rule can leave payments matching nothing, so it clears first.
 */
export async function serveMoneyAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('moneySetup')
  const found = await productOf(formData.get('slug'))
  if (!found) return { error: t('errors.notFound') }
  const { db } = services()
  const connection = await getConnection(db, found.org.id, text(formData.get('connection')))
  if (!connection) return { error: t('errors.notFound') }
  const rule = ruleOf(formData)
  if (!rule) return { error: t('errors.rule') }
  if (rule.mode === 'all') {
    const other = await allTakenBy(found.org.id, connection.id, found.project.id)
    if (other !== null) return { error: t('errors.allTaken', { product: other }) }
  }
  const reuse = formData.get('intent') === 'reuse'
  const current = (await listConnectionProjects(db, found.org.id)).find(
    (p) => p.connectionId === connection.id && p.projectId === found.project.id,
  )
  if (!reuse && current && sameRule(current.rule, rule)) return { done: true }
  await setConnectionProject(db, found.org.id, connection.id, found.project.id, rule)
  await readAgain(found.org.id, connection.id, !reuse)
  await setProjectArea(db, found.org.id, found.project.id, 'money', 'set_up')
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  if (reuse) redirect(`/p/${found.project.slug}/money/setup`)
  return { done: true }
}

/** "Update keys": a new read-only key or webhook secret; empty fields keep the old one. */
export async function updateMoneyKeysAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('moneySetup')
  const found = await productOf(formData.get('slug'))
  if (!found) return { error: t('errors.notFound') }
  const { db, env } = services()
  const connection = await getConnection(db, found.org.id, text(formData.get('connection')))
  if (!connection) return { error: t('errors.notFound') }
  const key = text(formData.get('key'))
  const webhookSecret = text(formData.get('webhookSecret'))
  if (!key && !webhookSecret) return { error: t('errors.nothing') }
  if (key) {
    const result = await checkKey(connection.integration, { key })
    if (!result.ok) return { error: t('errors.key', { message: result.message ?? '' }) }
  }
  const secrets = JSON.parse(connection.secrets) as Record<string, string>
  if (key) secrets.key = encryptSecret(key, env.OCTADASH_SECRET)
  if (webhookSecret) secrets.webhookSecret = encryptSecret(webhookSecret, env.OCTADASH_SECRET)
  await updateConnection(db, found.org.id, connection.id, {
    secrets: JSON.stringify(secrets),
    ...(key ? { keyHint: key.slice(-4) } : {}),
  })
  // A failing connection is read again in the next minute instead of waiting.
  if (key) await markConnection(db, connection.id, { status: 'importing', lastError: null })
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  return { done: true }
}

/**
 * "Stop using here": the product leaves the connection. The last product to
 * leave deletes it, with every payment and subscription read from it.
 */
export async function stopMoneyAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('moneySetup')
  const found = await productOf(formData.get('slug'))
  if (!found) return { error: t('errors.notFound') }
  const { db, clickhouse } = services()
  const connection = await getConnection(db, found.org.id, text(formData.get('connection')))
  if (!connection) return { error: t('errors.notFound') }
  await removeConnectionProject(db, found.org.id, connection.id, found.project.id)
  const all = await listConnectionProjects(db, found.org.id)
  if (!all.some((p) => p.connectionId === connection.id)) {
    await deleteConnection(db, found.org.id, connection.id)
    await deleteConnectionData(clickhouse, found.org.id, connection.id)
  } else {
    await readAgain(found.org.id, connection.id, true)
  }
  if (!all.some((p) => p.projectId === found.project.id))
    await setProjectArea(db, found.org.id, found.project.id, 'money', null)
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  return { done: true }
}
