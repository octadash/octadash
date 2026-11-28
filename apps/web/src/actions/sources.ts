'use server'

import {
  createSource,
  deleteSource,
  getProjectBySlug,
  getSource,
  renameSource,
  rotateSourceKey,
  stopOldKey,
} from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { FormState } from '@/components/action-form'
import { isRotateOverlap, ROTATE_OVERLAPS, SOURCE_PLATFORMS } from '@/lib/sources'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

const detailsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  platform: z.enum(SOURCE_PLATFORMS),
})

/** The source and its product, when both are this organization's. */
async function sourceOf(formData: FormData) {
  const { org } = await requireManager()
  const { db } = services()
  const source = await getSource(db, org.id, String(formData.get('source') ?? ''))
  if (!source) return null
  const project = await getProjectBySlug(db, org.id, String(formData.get('slug') ?? ''))
  if (!project || project.id !== source.project_id) return null
  return { org, project, source }
}

const pathOf = (slug: string, id?: string) => `/p/${slug}/settings/sources${id ? `/${id}` : ''}`

/** "Add source" on the Sources page: a name and a platform; areas come from what it sends. */
export async function addSourceAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org } = await requireManager()
  const parsed = detailsSchema.safeParse({
    name: formData.get('name'),
    platform: formData.get('platform'),
  })
  if (!parsed.success) return { error: t('checkFields') }
  const { db } = services()
  const project = await getProjectBySlug(db, org.id, String(formData.get('slug') ?? ''))
  if (!project) return { error: t('notFound') }
  const source = await createSource(db, org.id, project.id, { ...parsed.data, areas: [] })
  if (!source) return { error: t('notFound') }
  revalidatePath(`/p/${project.slug}`, 'layout')
  redirect(pathOf(project.slug, source.id))
}

/** Name and platform of one source. */
export async function updateSourceAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const parsed = detailsSchema.safeParse({
    name: formData.get('name'),
    platform: formData.get('platform'),
  })
  if (!parsed.success) return { error: t('checkFields') }
  const found = await sourceOf(formData)
  if (!found) return { error: t('notFound') }
  await renameSource(services().db, found.org.id, found.source.id, parsed.data)
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  return { done: true }
}

/** A new key now; the old one keeps working for the overlap picked. */
export async function rotateKeyAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const overlap = String(formData.get('overlap') ?? '')
  if (!isRotateOverlap(overlap)) return { error: t('checkFields') }
  const found = await sourceOf(formData)
  if (!found) return { error: t('notFound') }
  const ms = ROTATE_OVERLAPS[overlap]
  await rotateSourceKey(
    services().db,
    found.org.id,
    found.source.id,
    ms === 0 ? null : new Date(Date.now() + ms),
  )
  revalidatePath(pathOf(found.project.slug, found.source.id))
  return { done: true }
}

/** "Stop now" on an old key after a rotation. */
export async function stopOldKeyAction(formData: FormData) {
  const found = await sourceOf(formData)
  if (!found) return
  await stopOldKey(services().db, found.org.id, String(formData.get('key') ?? ''))
  revalidatePath(pathOf(found.project.slug, found.source.id))
}

/** Deletes a source and its keys; data already received stays. */
export async function deleteSourceAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const found = await sourceOf(formData)
  if (!found) return { error: t('notFound') }
  await deleteSource(services().db, found.org.id, found.source.id)
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  redirect(pathOf(found.project.slug))
}
