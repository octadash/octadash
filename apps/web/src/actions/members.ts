'use server'

import { countOwners } from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { isOwner, requireManager } from '@/server/session'
import { errorMessage } from './errors'

const ROLES = ['owner', 'admin', 'member'] as const

async function memberOf(orgId: string, memberId: string) {
  return services()
    .db.selectFrom('auth_member')
    .select(['id', 'role', 'userId'])
    .where('organizationId', '=', orgId)
    .where('id', '=', memberId)
    .executeTakeFirst()
}

/**
 * Changes someone's role. Only owners give or take the owner role, and the
 * organization always keeps at least one owner.
 */
export async function changeRoleAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org } = await requireManager()
  const parsed = z
    .object({ memberId: z.string().min(1), role: z.enum(ROLES) })
    .safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: t('checkFields') }
  const { db, auth } = services()
  const member = await memberOf(org.id, parsed.data.memberId)
  if (!member) return { error: t('notFound') }
  const wasOwner = isOwner(member.role)
  if ((wasOwner || parsed.data.role === 'owner') && !isOwner(org.role)) {
    return { error: t('ownersOnly') }
  }
  if (wasOwner && parsed.data.role !== 'owner' && (await countOwners(db, org.id)) <= 1) {
    return { error: t('lastOwner') }
  }
  try {
    await auth.api.updateMemberRole({
      body: { memberId: member.id, role: parsed.data.role, organizationId: org.id },
      headers: await headers(),
    })
  } catch (error) {
    return { error: errorMessage(error, t('generic')) }
  }
  revalidatePath('/settings/members')
  return { done: true }
}

/** Takes someone out of the organization. Owners only remove owners; never the last one. */
export async function removeMemberAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org, user } = await requireManager()
  const { db, auth } = services()
  const member = await memberOf(org.id, String(formData.get('memberId') ?? ''))
  if (!member) return { error: t('notFound') }
  if (member.userId === user.id) return { error: t('notYourself') }
  if (isOwner(member.role)) {
    if (!isOwner(org.role)) return { error: t('ownersOnly') }
    if ((await countOwners(db, org.id)) <= 1) return { error: t('lastOwner') }
  }
  try {
    await auth.api.removeMember({
      body: { memberIdOrEmail: member.id, organizationId: org.id },
      headers: await headers(),
    })
  } catch (error) {
    return { error: errorMessage(error, t('generic')) }
  }
  await db
    .deleteFrom('member_seen')
    .where('org_id', '=', org.id)
    .where('user_id', '=', member.userId)
    .execute()
  revalidatePath('/settings/members')
  return { done: true }
}
