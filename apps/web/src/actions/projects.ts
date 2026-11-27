'use server'

import { normalizeUrl } from '@octadash/core'
import { createProject, deleteProject, requestDiagnosis, updateProject } from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

const projectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().max(300).optional().default(''),
})

async function parseProject(formData: FormData) {
  const t = await getTranslations('errors')
  const parsed = projectSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: t('nameRequired') } as const
  const url = parsed.data.url ? normalizeUrl(parsed.data.url) : null
  if (parsed.data.url && !url) return { error: t('invalidUrl') } as const
  return { value: { name: parsed.data.name, url } } as const
}

export async function createProjectAction(_: FormState, formData: FormData): Promise<FormState> {
  const { org } = await requireManager()
  const input = await parseProject(formData)
  if ('error' in input) return { error: input.error }
  const { db } = services()
  const project = await createProject(db, org.id, input.value)
  await requestDiagnosis(db, org.id, project.id, 'created')
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
  const before = await db
    .selectFrom('project')
    .select('url')
    .where('org_id', '=', org.id)
    .where('id', '=', projectId)
    .executeTakeFirst()
  const project = await updateProject(db, org.id, projectId, input.value)
  if (!project) return { error: t('notFound') }
  if (project.url && project.url !== before?.url) {
    await requestDiagnosis(db, org.id, project.id, 'url_changed')
  }
  revalidatePath('/', 'layout')
  redirect(`/p/${project.slug}`)
}

export async function deleteProjectAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org } = await requireManager()
  if (formData.get('confirm') !== 'on') return { error: t('confirmDelete') }
  await deleteProject(services().db, org.id, String(formData.get('projectId') ?? ''))
  revalidatePath('/', 'layout')
  redirect('/all')
}
