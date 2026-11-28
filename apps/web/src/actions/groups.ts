'use server'

import { createGroup, deleteGroup, updateGroup } from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

async function parseGroup(formData: FormData) {
  const t = await getTranslations('groups.errors')
  const name = String(formData.get('name') ?? '').trim()
  if (!name || name.length > 80) return { error: t('name') } as const
  const projectIds = [...new Set(formData.getAll('project').map(String))]
  return { value: { name, projectIds } } as const
}

/** Creates a group and opens it. */
export async function createGroupAction(_: FormState, formData: FormData): Promise<FormState> {
  const { org } = await requireManager()
  const input = await parseGroup(formData)
  if ('error' in input) return { error: input.error }
  const group = await createGroup(services().db, org.id, input.value)
  revalidatePath('/', 'layout')
  redirect(`/g/${group.slug}`)
}

export async function updateGroupAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('groups.errors')
  const { org } = await requireManager()
  const input = await parseGroup(formData)
  if ('error' in input) return { error: input.error }
  const groupId = String(formData.get('groupId') ?? '')
  const group = await updateGroup(services().db, org.id, groupId, input.value)
  if (!group) return { error: t('notFound') }
  revalidatePath('/', 'layout')
  redirect(`/g/${group.slug}`)
}

export async function deleteGroupAction(_: FormState, formData: FormData): Promise<FormState> {
  const { org } = await requireManager()
  await deleteGroup(services().db, org.id, String(formData.get('groupId') ?? ''))
  revalidatePath('/', 'layout')
  redirect('/all')
}
