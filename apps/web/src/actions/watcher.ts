'use server'

import { encryptSecret } from '@octadash/core'
import { recordWatcherPing, setWatcherUrl } from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

const urlSchema = z.url({ protocol: /^https?$/ })

/**
 * Saves the outside watcher's ping URL after one ping that works, so a typo is
 * caught here and not when the server is already down.
 */
export async function saveWatcherAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('watcher.errors')
  await requireManager()
  const { db, env } = services()
  const parsed = urlSchema.safeParse(String(formData.get('url') ?? '').trim())
  if (!parsed.success) return { error: t('url') }
  try {
    const res = await fetch(parsed.data, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'Octadash-Watcher' },
    })
    await res.body?.cancel()
    if (!res.ok) return { error: t('ping', { reason: `HTTP ${res.status}` }) }
  } catch (err) {
    return { error: t('ping', { reason: err instanceof Error ? err.message : String(err) }) }
  }
  await setWatcherUrl(db, encryptSecret(parsed.data, env.OCTADASH_SECRET))
  await recordWatcherPing(db, 'ok', null, new Date())
  revalidatePath('/settings', 'layout')
  return { done: true }
}

export async function removeWatcherAction(_: FormState, _formData: FormData): Promise<FormState> {
  await requireManager()
  await setWatcherUrl(services().db, null)
  revalidatePath('/settings', 'layout')
  return { done: true }
}
