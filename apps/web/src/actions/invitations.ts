'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'
import { errorMessage } from './errors'

const inviteSchema = z.object({ email: z.email(), role: z.enum(['member', 'admin']) })

export async function inviteAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org } = await requireManager()
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: t('checkFields') }
  try {
    await services().auth.api.createInvitation({
      body: { ...parsed.data, organizationId: org.id },
      headers: await headers(),
    })
  } catch (error) {
    return { error: errorMessage(error, t('generic')) }
  }
  redirect('/settings/members')
}

export async function cancelInvitationAction(formData: FormData) {
  await services().auth.api.cancelInvitation({
    body: { invitationId: String(formData.get('invitationId') ?? '') },
    headers: await headers(),
  })
  redirect('/settings/members')
}

const joinSchema = z.object({
  invitationId: z.string().min(1),
  name: z.string().trim().min(1),
  password: z.string().min(10),
})

/**
 * An invited person creates their account and joins in the same step, landing
 * on the Overview of that organization. If joining fails, the invite page
 * still offers to accept.
 */
export async function signUpInvitedAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const parsed = joinSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: t('checkFields') }
  const { db } = services()
  const invitation = await db
    .selectFrom('auth_invitation')
    .select(['email', 'organizationId', 'role'])
    .where('id', '=', parsed.data.invitationId)
    .where('status', '=', 'pending')
    .where('expiresAt', '>', new Date())
    .executeTakeFirst()
  if (!invitation) return { error: t('invitationInvalid') }
  const { auth } = services()
  let userId: string
  try {
    const { user } = await auth.api.signUpEmail({
      body: { name: parsed.data.name, email: invitation.email, password: parsed.data.password },
      headers: await headers(),
    })
    userId = user.id
  } catch (error) {
    return { error: errorMessage(error, t('generic')) }
  }
  try {
    await auth.api.addMember({
      body: {
        userId,
        organizationId: invitation.organizationId,
        role: invitation.role === 'admin' ? 'admin' : 'member',
      },
    })
    await db
      .updateTable('auth_invitation')
      .set({ status: 'accepted' })
      .where('id', '=', parsed.data.invitationId)
      .execute()
  } catch {
    redirect(`/invite/${parsed.data.invitationId}`)
  }
  redirect('/all')
}

export async function acceptInvitationAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const invitationId = String(formData.get('invitationId') ?? '')
  try {
    const result = await services().auth.api.acceptInvitation({
      body: { invitationId },
      headers: await headers(),
    })
    if (result?.member) {
      await services().auth.api.setActiveOrganization({
        body: { organizationId: result.member.organizationId },
        headers: await headers(),
      })
    }
  } catch (error) {
    return { error: errorMessage(error, t('generic')) }
  }
  redirect('/all')
}
