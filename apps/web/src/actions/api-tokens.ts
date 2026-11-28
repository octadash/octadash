'use server'

import {
  cleanScopes,
  createApiToken,
  isEmptyScopes,
  revokeApiToken,
  type TokenScopes,
} from '@octadash/db'
import { revalidatePath } from 'next/cache'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

/**
 * A new token with what it may touch, resource by resource. It comes back
 * once, to copy; only its hash is kept. A token that may touch nothing is
 * refused.
 */
export async function createApiTokenAction(
  name: string,
  scopes: TokenScopes,
): Promise<{ token: string }> {
  const { org, user } = await requireManager()
  const clean = cleanScopes(scopes)
  if (isEmptyScopes(clean)) throw new Error('A token needs at least one item it can read.')
  const token = await createApiToken(services().db, org.id, user.id, name, clean)
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
