'use server'

import {
  addSourceArea,
  createSource,
  deleteLogSearch,
  getProjectBySlug,
  LOG_RETENTION_CHOICES,
  listLogSearches,
  listSources,
  saveLogSearch,
  setLogRetention,
  setProjectArea,
  trimLogs,
} from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { FormState } from '@/components/action-form'
import { LOG_SOURCE_PLATFORMS } from '@/lib/logs-setup'
import { services } from '@/server/context'
import { canManage, requireManager, requireOrg } from '@/server/session'

async function productOf(slug: string) {
  const { org, user } = await requireManager()
  const project = await getProjectBySlug(services().db, org.id, slug)
  return project ? { org, user, project } : null
}

const sourceSchema = z.object({
  slug: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  platform: z.enum(LOG_SOURCE_PLATFORMS),
})

/** "Add source" on Set up Logs: a new source that sends log lines, with its own key. */
export async function addLogSourceAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const parsed = sourceSchema.safeParse({
    slug: formData.get('slug'),
    name: formData.get('name'),
    platform: formData.get('platform'),
  })
  if (!parsed.success) return { error: t('checkFields') }
  const found = await productOf(parsed.data.slug)
  if (!found) return { error: t('notFound') }
  const { db } = services()
  const source = await createSource(db, found.org.id, found.project.id, {
    name: parsed.data.name,
    platform: parsed.data.platform,
    areas: ['logs'],
  })
  if (!source) return { error: t('notFound') }
  await setProjectArea(db, found.org.id, found.project.id, 'logs', 'set_up')
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  redirect(`/p/${found.project.slug}/logs/setup?source=${source.id}`)
}

/** "Use for Logs": a source that already sends errors or events sends log lines with the same key. */
export async function addLogsToSourceAction(formData: FormData) {
  const found = await productOf(String(formData.get('slug') ?? ''))
  if (!found) return
  const id = String(formData.get('source') ?? '')
  const { db } = services()
  const sources = await listSources(db, found.org.id, found.project.id)
  if (!sources.some((s) => s.id === id)) return
  await addSourceArea(db, found.org.id, id, 'logs')
  await setProjectArea(db, found.org.id, found.project.id, 'logs', 'set_up')
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  redirect(`/p/${found.project.slug}/logs/setup?source=${id}`)
}

/**
 * Step 2 of Set up Logs: how long the product keeps its lines. A shorter
 * choice deletes what is now too old at once.
 */
export async function saveLogRetentionAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const days = Number(formData.get('days'))
  if (!(LOG_RETENTION_CHOICES as readonly number[]).includes(days)) {
    return { error: t('checkFields') }
  }
  const found = await productOf(String(formData.get('slug') ?? ''))
  if (!found) return { error: t('notFound') }
  const { db, clickhouse } = services()
  const before = await setLogRetention(db, found.org.id, found.project.id, days)
  if (before === null) return { error: t('notFound') }
  if (days < before) {
    await trimLogs(clickhouse, found.org.id, found.project.id, days).catch(() => {})
  }
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  revalidatePath('/all/logs')
  return { done: true }
}

const searchSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  query: z.string().trim().min(1).max(2000),
  alert: z.boolean(),
})

/**
 * "Save search" and editing one. Any member can save a search; turning its
 * Alert on is a rule for everyone, so only owners and admins can.
 */
export async function saveLogSearchAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('logsArea.save')
  const parsed = searchSchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    query: formData.get('query'),
    alert: formData.get('alert') === 'on',
  })
  if (!parsed.success) return { error: t('checkFields') }
  const { org, user } = await requireOrg()
  if (parsed.data.alert && !canManage(org.role)) return { error: t('alertManagers') }
  const id = await saveLogSearch(
    services().db,
    org.id,
    { name: parsed.data.name, query: parsed.data.query, alert: parsed.data.alert },
    user.id,
    parsed.data.id,
  )
  if (!id) return { error: t('notFound') }
  revalidatePath('/', 'layout')
  return { done: true }
}

/** Deleting a search with Alert on removes a rule, so it takes an owner or admin. */
export async function deleteLogSearchAction(formData: FormData) {
  const { org } = await requireOrg()
  const { db } = services()
  const id = String(formData.get('id') ?? '')
  const search = (await listLogSearches(db, org.id)).find((s) => s.id === id)
  if (!search || (search.alert && !canManage(org.role))) return
  await deleteLogSearch(db, org.id, id)
  revalidatePath('/', 'layout')
}
