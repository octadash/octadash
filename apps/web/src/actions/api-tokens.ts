'use server'

import { createApiToken, revokeApiToken } from '@octadash/db'
import { revalidatePath } from 'next/cache'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

/** A new read-only token. It comes back once, to copy; only its hash is kept. */
export async function createApiTokenAction(name: string): Promise<{ token: string }> {
  const { org, user } = await requireManager()
  const token = await createApiToken(services().db, org.id, user.id, name)
  revalidatePath('/settings/api-tokens')
  return { token }
}

/** Stops a token at once: the next call with it gets 401. */
export async function revokeApiTokenAction(_: FormState, formData: FormData): Promise<FormState> {
  const { org } = await requireManager()
  await revokeApiToken(services().db, org.id, String(formData.get('id') ?? ''))
  revalidatePath('/settings/api-tokens')
  return { done: true }
}
