'use server'

import {
  addSourceArea,
  createSource,
  getProjectBySlug,
  listSources,
  setProjectArea,
} from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { FormState } from '@/components/action-form'
import { ERROR_PLATFORMS } from '@/lib/errors-setup'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

const sourceSchema = z.object({
  slug: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  platform: z.enum(ERROR_PLATFORMS),
})

async function productOf(slug: string) {
  const { org } = await requireManager()
  const project = await getProjectBySlug(services().db, org.id, slug)
  return project ? { org, project } : null
}

/** "Add source" on Set up Errors: a new source that sends errors, with its own key. */
export async function addErrorSourceAction(_: FormState, formData: FormData): Promise<FormState> {
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
    areas: ['errors'],
  })
  if (!source) return { error: t('notFound') }
  await setProjectArea(db, found.org.id, found.project.id, 'errors', 'set_up')
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  redirect(`/p/${found.project.slug}/errors/setup?source=${source.id}`)
}

/** "Use for Errors": a source that already sends page views or events starts sending errors too. */
export async function addErrorsToSourceAction(formData: FormData) {
  const found = await productOf(String(formData.get('slug') ?? ''))
  if (!found) return
  const id = String(formData.get('source') ?? '')
  const { db } = services()
  const sources = await listSources(db, found.org.id, found.project.id)
  if (!sources.some((s) => s.id === id)) return
  await addSourceArea(db, found.org.id, id, 'errors')
  await setProjectArea(db, found.org.id, found.project.id, 'errors', 'set_up')
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  redirect(`/p/${found.project.slug}/errors/setup?source=${id}`)
}
