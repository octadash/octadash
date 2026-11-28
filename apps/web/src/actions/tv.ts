'use server'

import { createTvLink, stopTvLink } from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { parseTvSettings } from '@/lib/tv'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

/**
 * A private TV link with these settings; the one before stops. The token comes
 * back once, to show in the link; only its hash is kept.
 */
export async function createTvLinkAction(input: {
  scope: string
  metrics: string[]
  perPage: number
  sound: boolean
}): Promise<{ token: string }> {
  const { org, user } = await requireManager()
  const settings = parseTvSettings(input)
  const token = await createTvLink(services().db, org.id, user.id, settings)
  revalidatePath('/', 'layout')
  return { token }
}

/** "Stop this link": every TV that had it goes blank on its next update. */
export async function stopTvLinkAction() {
  const { org } = await requireManager()
  await stopTvLink(services().db, org.id)
  revalidatePath('/', 'layout')
}
