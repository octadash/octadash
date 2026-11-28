'use server'

import { hideGetStarted } from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

/** Hides the "Get started" list for the whole organization, for good. */
export async function hideGetStartedAction() {
  const { org } = await requireManager()
  await hideGetStarted(services().db, org.id)
  revalidatePath('/', 'layout')
}
