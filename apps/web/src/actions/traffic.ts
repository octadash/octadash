'use server'

import {
  addSourceArea,
  createSource,
  getProjectBySlug,
  listSources,
  setProjectArea,
  setSourceVisitorMode,
} from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { FormState } from '@/components/action-form'
import { TRAFFIC_PLATFORMS } from '@/lib/traffic-setup'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

const sourceSchema = z.object({
  slug: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  platform: z.enum(TRAFFIC_PLATFORMS),
})

async function productOf(slug: string) {
  const { org } = await requireManager()
  const project = await getProjectBySlug(services().db, org.id, slug)
  return project ? { org, project } : null
}

/** "Add source" on Set up Traffic: a new source that feeds Traffic, with its own key. */
export async function addTrafficSourceAction(_: FormState, formData: FormData): Promise<FormState> {
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
    areas: ['traffic'],
  })
  if (!source) return { error: t('notFound') }
  await setProjectArea(db, found.org.id, found.project.id, 'traffic', 'set_up')
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  redirect(`/p/${found.project.slug}/traffic/setup?source=${source.id}`)
}

/** "Use for Traffic": a source that already sends errors or events starts sending page views too. */
export async function addTrafficToSourceAction(formData: FormData) {
  const found = await productOf(String(formData.get('slug') ?? ''))
  if (!found) return
  const id = String(formData.get('source') ?? '')
  const { db } = services()
  const sources = await listSources(db, found.org.id, found.project.id)
  if (!sources.some((s) => s.id === id)) return
  await addSourceArea(db, found.org.id, id, 'traffic')
  await setProjectArea(db, found.org.id, found.project.id, 'traffic', 'set_up')
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  redirect(`/p/${found.project.slug}/traffic/setup?source=${id}`)
}

/** "Count returning visitors" on one source. The snippet on the page follows it. */
export async function setVisitorModeAction(formData: FormData) {
  const found = await productOf(String(formData.get('slug') ?? ''))
  if (!found) return
  const id = String(formData.get('source') ?? '')
  const mode = formData.get('mode') === 'persistent' ? 'persistent' : 'daily'
  const { db } = services()
  const sources = await listSources(db, found.org.id, found.project.id)
  if (!sources.some((s) => s.id === id)) return
  await setSourceVisitorMode(db, found.org.id, id, mode)
  revalidatePath(`/p/${found.project.slug}/traffic`, 'layout')
}
