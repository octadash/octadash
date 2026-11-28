'use server'

import { randomBytes, randomUUID } from 'node:crypto'
import { encryptSecret } from '@octadash/core'
import {
  type CostShareInput,
  type CostSplit,
  createConnection,
  deleteConnection,
  getConnection,
  getOrganizationSettings,
  getProjectBySlug,
  listCostShares,
  markConnection,
  removeCostShare,
  saveFixedCost,
  setConnectionSplit,
  setCostBudget,
  setCostShare,
  setProjectArea,
  updateConnection,
} from '@octadash/db'
import { type CostTag, costProvider, SPLIT_MODES } from '@octadash/integrations'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { FormState } from '@/components/action-form'
import { parseAmount } from '@/lib/costs'
import { digitsOf } from '@/lib/money'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

async function productOf(slug: unknown) {
  const { org } = await requireManager()
  if (typeof slug !== 'string' || !slug) return null
  const project = await getProjectBySlug(services().db, org.id, slug)
  return project ? { org, project } : null
}

const text = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value.trim() : '')

/** Tags ticked from "Test key" or typed with commas, the rest and the split, from the form. */
function shareOf(formData: FormData): { share: CostShareInput; split: CostSplit } {
  const tags = [...formData.getAll('tag').map(text), ...text(formData.get('tagIds')).split(',')]
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 200)
  const split = text(formData.get('split'))
  const percent = Number(text(formData.get('percent')).replace(',', '.'))
  return {
    share: {
      tags,
      // Without the box (a fixed bill has no tags), the product takes part of the rest.
      rest: formData.has('restShown') ? formData.get('rest') === 'on' : true,
      percent: text(formData.get('percent')) && Number.isFinite(percent) ? percent : null,
    },
    split: (SPLIT_MODES as string[]).includes(split) ? (split as CostSplit) : 'equal',
  }
}

async function checkKey(providerId: string, key: string) {
  const provider = costProvider(providerId)
  if (!provider) return { ok: false, message: 'unknown provider' }
  try {
    return await provider.check({ key }, { fetch, signal: AbortSignal.timeout(15_000) })
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export interface CostKeyTest {
  ok: boolean
  message?: string
  tags: CostTag[]
}

/** "Test key": reads the provider and lists its projects or workspaces. */
export async function testCostKeyAction(input: {
  slug: string
  provider: string
  key: string
}): Promise<CostKeyTest> {
  const t = await getTranslations('costsSetup')
  if (!(await productOf(input.slug))) return { ok: false, message: t('errors.notFound'), tags: [] }
  const provider = costProvider(input.provider)
  const key = input.key.trim()
  if (!provider || !key) return { ok: false, message: t('errors.noKey'), tags: [] }
  const result = await checkKey(provider.id, key)
  if (!result.ok) return { ok: false, message: result.message, tags: [] }
  try {
    const tags = await provider.tags({ key }, { fetch, signal: AbortSignal.timeout(15_000) })
    return { ok: true, tags: tags.slice(0, 200) }
  } catch (err) {
    return { ok: true, message: err instanceof Error ? err.message : String(err), tags: [] }
  }
}

/** A fixed bill from the form; an error key when a field is wrong. */
async function billOf(formData: FormData) {
  const currency = text(formData.get('currency')).toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'currency' as const }
  const amount = parseAmount(text(formData.get('amount')), digitsOf(currency))
  if (amount === null || amount <= 0) return { error: 'amount' as const }
  const startsOn = text(formData.get('startsOn'))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || Number.isNaN(Date.parse(startsOn)))
    return { error: 'startsOn' as const }
  return {
    amount,
    currency,
    every: text(formData.get('every')) === 'year' ? ('year' as const) : ('month' as const),
    startsOn,
  }
}

/**
 * "Connect": a provider read with a read-only key, or a fixed bill typed in.
 * The worker reads the last 90 days of a provider within minutes.
 */
export async function connectCostAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('costsSetup')
  const found = await productOf(formData.get('slug'))
  if (!found) return { error: t('errors.notFound') }
  const { db, env } = services()
  const kind = text(formData.get('provider'))
  const { share, split } = shareOf(formData)
  const token = randomBytes(16).toString('hex')

  let connectionId: string
  if (kind === 'fixed') {
    const name = text(formData.get('name')).slice(0, 80)
    if (!name) return { error: t('errors.name') }
    const bill = await billOf(formData)
    if ('error' in bill) return { error: t(`errors.${bill.error}`) }
    const connection = await createConnection(db, found.org.id, randomUUID(), {
      integration: 'fixed',
      name,
      secrets: '{}',
      keyHint: '',
      webhookToken: token,
    })
    await markConnection(db, connection.id, { status: 'ok' })
    await saveFixedCost(db, found.org.id, { connectionId: connection.id, ...bill })
    connectionId = connection.id
  } else {
    const provider = costProvider(kind)
    if (!provider) return { error: t('errors.provider') }
    const key = text(formData.get('key'))
    if (!key) return { error: t('errors.noKey') }
    const result = await checkKey(provider.id, key)
    if (!result.ok) return { error: t('errors.key', { message: result.message ?? '' }) }
    const connection = await createConnection(db, found.org.id, randomUUID(), {
      integration: provider.id,
      name: text(formData.get('name')).slice(0, 80) || provider.name,
      secrets: JSON.stringify({ key: encryptSecret(key, env.OCTADASH_SECRET) }),
      keyHint: key.slice(-4),
      webhookToken: token,
    })
    connectionId = connection.id
  }
  await setConnectionSplit(db, found.org.id, connectionId, split)
  await setCostShare(db, found.org.id, connectionId, found.project.id, share)
  await setProjectArea(db, found.org.id, found.project.id, 'costs', 'set_up')
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  redirect(`/p/${found.project.slug}/costs/setup`)
}

/**
 * "Use it here too" and "Save" on a connection's part: which tags are this
 * product's, whether it shares the rest, and how the rest is split. The
 * split is the connection's, so it changes for every product it serves.
 * Costs are divided when read, so the change shows at once.
 */
export async function shareCostAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('costsSetup')
  const found = await productOf(formData.get('slug'))
  if (!found) return { error: t('errors.notFound') }
  const { db } = services()
  const connection = await getConnection(db, found.org.id, text(formData.get('connection')))
  if (!connection) return { error: t('errors.notFound') }
  const { share, split } = shareOf(formData)
  const taken = (await listCostShares(db, found.org.id)).find(
    (s) =>
      s.connectionId === connection.id &&
      s.projectId !== found.project.id &&
      s.tags.some((tag) => share.tags.includes(tag)),
  )
  if (taken) {
    const other = await db
      .selectFrom('project')
      .select('name')
      .where('id', '=', taken.projectId)
      .executeTakeFirst()
    return { error: t('errors.tagTaken', { product: other?.name ?? '' }) }
  }
  await setConnectionSplit(db, found.org.id, connection.id, split)
  await setCostShare(db, found.org.id, connection.id, found.project.id, share)
  await setProjectArea(db, found.org.id, found.project.id, 'costs', 'set_up')
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  if (formData.get('intent') === 'reuse') redirect(`/p/${found.project.slug}/costs/setup`)
  return { done: true }
}

/** "Update key": a new read-only key, checked first; a failing connection is read again now. */
export async function updateCostKeyAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('costsSetup')
  const found = await productOf(formData.get('slug'))
  if (!found) return { error: t('errors.notFound') }
  const { db, env } = services()
  const connection = await getConnection(db, found.org.id, text(formData.get('connection')))
  if (!connection) return { error: t('errors.notFound') }
  const key = text(formData.get('key'))
  if (!key) return { error: t('errors.noKey') }
  const result = await checkKey(connection.integration, key)
  if (!result.ok) return { error: t('errors.key', { message: result.message ?? '' }) }
  await updateConnection(db, found.org.id, connection.id, {
    secrets: JSON.stringify({ key: encryptSecret(key, env.OCTADASH_SECRET) }),
    keyHint: key.slice(-4),
  })
  await markConnection(db, connection.id, { status: 'importing', lastError: null })
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  return { done: true }
}

/** "Change the bill": amount, currency, how often and since when. */
export async function updateFixedCostAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('costsSetup')
  const found = await productOf(formData.get('slug'))
  if (!found) return { error: t('errors.notFound') }
  const { db } = services()
  const connection = await getConnection(db, found.org.id, text(formData.get('connection')))
  if (connection?.integration !== 'fixed') return { error: t('errors.notFound') }
  const bill = await billOf(formData)
  if ('error' in bill) return { error: t(`errors.${bill.error}`) }
  const name = text(formData.get('name')).slice(0, 80)
  if (name && name !== connection.name)
    await updateConnection(db, found.org.id, connection.id, { name })
  await saveFixedCost(db, found.org.id, { connectionId: connection.id, ...bill })
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  return { done: true }
}

/**
 * "Stop using here": the product leaves the connection. The last product to
 * leave deletes it, with every cost read from it.
 */
export async function stopCostAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('costsSetup')
  const found = await productOf(formData.get('slug'))
  if (!found) return { error: t('errors.notFound') }
  const { db } = services()
  const connection = await getConnection(db, found.org.id, text(formData.get('connection')))
  if (!connection) return { error: t('errors.notFound') }
  await removeCostShare(db, found.org.id, connection.id, found.project.id)
  const shares = await listCostShares(db, found.org.id)
  if (!shares.some((s) => s.connectionId === connection.id))
    await deleteConnection(db, found.org.id, connection.id)
  if (!shares.some((s) => s.projectId === found.project.id))
    await setProjectArea(db, found.org.id, found.project.id, 'costs', null)
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  return { done: true }
}

/** The product's monthly budget, in the organization's currency; empty clears it. */
export async function costBudgetAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('costsSetup')
  const found = await productOf(formData.get('slug'))
  if (!found) return { error: t('errors.notFound') }
  const { db } = services()
  const typed = text(formData.get('amount'))
  if (!typed || formData.get('intent') === 'clear') {
    await setCostBudget(db, found.org.id, found.project.id, null)
  } else {
    const { currency } = await getOrganizationSettings(db, found.org.id)
    const amount = parseAmount(typed, digitsOf(currency))
    if (amount === null || amount <= 0) return { error: t('errors.amount') }
    const warn = Number(text(formData.get('warn')) || 80)
    await setCostBudget(db, found.org.id, found.project.id, {
      amount,
      warn: Number.isFinite(warn) ? warn : 80,
    })
  }
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  return { done: true }
}
