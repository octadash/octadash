'use server'

import { createProject, deleteProject, listProjects, updateProject } from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

/** A product is created with its name only; platforms are chosen inside each area. */
const projectSchema = z.object({
  name: z.string().trim().min(1).max(80),
})

async function parseProject(formData: FormData) {
  const t = await getTranslations('errors')
  const parsed = projectSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: t('nameRequired') } as const
  return { value: { name: parsed.data.name } } as const
}

export async function createProjectAction(_: FormState, formData: FormData): Promise<FormState> {
  const { org } = await requireManager()
  const input = await parseProject(formData)
  if ('error' in input) return { error: input.error }
  const { db } = services()
  const project = await createProject(db, org.id, input.value)
  revalidatePath('/', 'layout')
  redirect(`/p/${project.slug}`)
}

export async function updateProjectAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org } = await requireManager()
  const input = await parseProject(formData)
  if ('error' in input) return { error: input.error }
  const { db } = services()
  const projectId = String(formData.get('projectId') ?? '')
  const before = String(formData.get('slug') ?? '')
  const project = await updateProject(db, org.id, projectId, input.value)
  if (!project) return { error: t('notFound') }
  revalidatePath('/', 'layout')
  // A new name moves the address: open settings there, so the page shows it.
  if (project.slug !== before) redirect(`/p/${project.slug}/settings`)
  return { done: true }
}

export async function deleteProjectAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org } = await requireManager()
  const { db } = services()
  const projectId = String(formData.get('projectId') ?? '')
  const project = (await listProjects(db, org.id)).find((p) => p.id === projectId)
  if (!project) return { error: t('notFound') }
  if (String(formData.get('confirm') ?? '').trim() !== project.name) {
    return { error: t('nameMismatch') }
  }
  await deleteProject(db, org.id, project.id)
  revalidatePath('/', 'layout')
  redirect('/all')
}
