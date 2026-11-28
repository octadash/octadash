'use server'

import {
  addSourceArea,
  createSource,
  deleteFunnel,
  getProjectBySlug,
  listFunnels,
  listKeyEvents,
  listSources,
  saveFunnel,
  setKeyEvent,
  setProjectArea,
} from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { FormState } from '@/components/action-form'
import { parseSteps } from '@/lib/usage'
import { USAGE_SOURCE_PLATFORMS } from '@/lib/usage-setup'
import { services } from '@/server/context'
import { requireManager, requireOrg } from '@/server/session'

async function productOf(slug: string, manager = true) {
  const { org, user } = manager ? await requireManager() : await requireOrg()
  const project = await getProjectBySlug(services().db, org.id, slug)
  return project ? { org, user, project } : null
}

const EVENT_NAME = /^[^\s].{0,199}$/

const sourceSchema = z.object({
  slug: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  platform: z.enum(USAGE_SOURCE_PLATFORMS),
})

/** "Add source" on Set up Product usage: a new source that sends events, with its own key. */
export async function addUsageSourceAction(_: FormState, formData: FormData): Promise<FormState> {
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
    areas: ['usage'],
  })
  if (!source) return { error: t('notFound') }
  await setProjectArea(db, found.org.id, found.project.id, 'usage', 'set_up')
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  redirect(`/p/${found.project.slug}/usage/setup?source=${source.id}`)
}

/** "Use for Product usage": a source that already sends page views sends events with the same key. */
export async function addUsageToSourceAction(formData: FormData) {
  const found = await productOf(String(formData.get('slug') ?? ''))
  if (!found) return
  const id = String(formData.get('source') ?? '')
  const { db } = services()
  const sources = await listSources(db, found.org.id, found.project.id)
  if (!sources.some((s) => s.id === id)) return
  await addSourceArea(db, found.org.id, id, 'usage')
  await setProjectArea(db, found.org.id, found.project.id, 'usage', 'set_up')
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  redirect(`/p/${found.project.slug}/usage/setup?source=${id}`)
}

/**
 * Step 3 of Set up Product usage: the product's key events become the ones
 * checked, plus one typed by name for an event not seen yet.
 */
export async function saveKeyEventsAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const found = await productOf(String(formData.get('slug') ?? ''))
  if (!found) return { error: t('notFound') }
  const { db } = services()
  const shown = formData.getAll('shown').map(String)
  const checked = new Set(formData.getAll('key').map(String))
  const typed = String(formData.get('new') ?? '').trim()
  if (typed) {
    if (!EVENT_NAME.test(typed)) return { error: t('checkFields') }
    checked.add(typed)
  }
  const current = await listKeyEvents(db, found.org.id, [found.project.id])
  for (const event of new Set([...shown, ...checked])) {
    if (!EVENT_NAME.test(event)) continue
    const key = checked.has(event)
    if (key === current.some((k) => k.event === event)) continue
    await setKeyEvent(db, found.org.id, found.project.id, event, key, found.user.id)
  }
  await setProjectArea(db, found.org.id, found.project.id, 'usage', 'set_up')
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  revalidatePath('/all/usage')
  return { done: true }
}

const funnelSchema = z.object({
  slug: z.string().min(1),
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  windowDays: z.coerce.number().int().min(1).max(90),
})

/** "New funnel" and editing one: a name, steps in order and the days to finish them. */
export async function saveFunnelAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('usageArea.funnel')
  const parsed = funnelSchema.safeParse({
    slug: formData.get('slug'),
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    windowDays: formData.get('windowDays'),
  })
  const steps = parseSteps(String(formData.get('steps') ?? ''))
  if (!parsed.success) return { error: t('checkFields') }
  if (steps.length < 2) return { error: t('twoSteps') }
  const found = await productOf(parsed.data.slug, false)
  if (!found) return { error: t('notFound') }
  const { db } = services()
  if (parsed.data.id) {
    const own = await listFunnels(db, found.org.id, [found.project.id])
    if (!own.some((f) => f.id === parsed.data.id)) return { error: t('notFound') }
  }
  await saveFunnel(
    db,
    found.org.id,
    found.project.id,
    { name: parsed.data.name, steps, windowDays: parsed.data.windowDays },
    found.user.id,
    parsed.data.id,
  )
  revalidatePath(`/p/${found.project.slug}/usage`)
  revalidatePath('/all/usage')
  return { done: true }
}

export async function deleteFunnelAction(formData: FormData) {
  const found = await productOf(String(formData.get('slug') ?? ''), false)
  if (!found) return
  await deleteFunnel(services().db, found.org.id, String(formData.get('id') ?? ''))
  revalidatePath(`/p/${found.project.slug}/usage`)
  revalidatePath('/all/usage')
}
