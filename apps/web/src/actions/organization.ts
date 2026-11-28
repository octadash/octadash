'use server'

import { slugify } from '@octadash/core'
import {
  deleteOrganizationData,
  getOrganizationSettings,
  isCurrency,
  isTimeZone,
  saveOrganizationSettings,
} from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { isOwner, requireManager, requireOrg } from '@/server/session'
import { errorMessage } from './errors'

const nameSchema = z.string().trim().min(1).max(80)

export async function renameOrgAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org } = await requireManager()
  const name = nameSchema.safeParse(formData.get('name'))
  if (!name.success) return { error: t('nameRequired') }
  try {
    await services().auth.api.updateOrganization({
      body: { organizationId: org.id, data: { name: name.data } },
      headers: await headers(),
    })
  } catch (error) {
    return { error: errorMessage(error, t('generic')) }
  }
  revalidatePath('/', 'layout')
  return { done: true }
}

const regionSchema = z.object({
  currency: z.string().refine(isCurrency),
  timeZone: z.string().refine(isTimeZone),
})

export async function saveRegionAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org } = await requireManager()
  const parsed = regionSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: t('checkFields') }
  await saveOrganizationSettings(services().db, org.id, parsed.data)
  revalidatePath('/', 'layout')
  return { done: true }
}

/** Owners only, after typing the organization's name. */
export async function deleteOrgAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org } = await requireOrg()
  if (!isOwner(org.role)) return { error: t('ownersOnly') }
  if (String(formData.get('confirm') ?? '').trim() !== org.name) return { error: t('typeName') }
  const { auth, db } = services()
  try {
    await auth.api.deleteOrganization({
      body: { organizationId: org.id },
      headers: await headers(),
    })
  } catch (error) {
    return { error: errorMessage(error, t('generic')) }
  }
  await deleteOrganizationData(db, org.id)
  revalidatePath('/', 'layout')
  redirect('/all')
}

/** Another organization in this install, owned by whoever creates it. */
export async function createOrgAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org } = await requireOrg()
  if (!isOwner(org.role)) return { error: t('ownersOnly') }
  const name = nameSchema.safeParse(formData.get('name'))
  if (!name.success) return { error: t('nameRequired') }
  const { auth, db } = services()
  try {
    const created = await auth.api.createOrganization({
      body: { name: name.data, slug: `${slugify(name.data)}-${crypto.randomUUID().slice(0, 6)}` },
      headers: await headers(),
    })
    if (created) {
      // The new organization starts with the same currency and time zone.
      await saveOrganizationSettings(db, created.id, await getOrganizationSettings(db, org.id))
      await auth.api.setActiveOrganization({
        body: { organizationId: created.id },
        headers: await headers(),
      })
    }
  } catch (error) {
    return { error: errorMessage(error, t('generic')) }
  }
  revalidatePath('/', 'layout')
  redirect('/products/new')
}

const passwordSchema = z.object({
  current: z.string().min(1),
  next: z.string().min(10),
})

export async function renameMeAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  await requireOrg()
  const name = nameSchema.safeParse(formData.get('name'))
  if (!name.success) return { error: t('nameRequired') }
  await services().auth.api.updateUser({ body: { name: name.data }, headers: await headers() })
  revalidatePath('/', 'layout')
  return { done: true }
}

export async function changePasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  await requireOrg()
  const parsed = passwordSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: t('checkFields') }
  try {
    await services().auth.api.changePassword({
      body: {
        currentPassword: parsed.data.current,
        newPassword: parsed.data.next,
        revokeOtherSessions: true,
      },
      headers: await headers(),
    })
  } catch {
    return { error: t('wrongPassword') }
  }
  return { done: true }
}
