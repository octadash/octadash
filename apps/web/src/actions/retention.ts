'use server'

import {
  getProjectBySlug,
  isRetentionArea,
  isRetentionChoice,
  setAreaRetention,
  trimErrors,
  trimLogs,
} from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

/**
 * Product settings › Data kept: how long one area keeps the product's data. A
 * longer choice applies to what arrives next; a shorter one also deletes what
 * is now too old.
 */
export async function saveRetentionAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const area = String(formData.get('area') ?? '')
  const days = Number(formData.get('days'))
  if (!isRetentionArea(area) || !isRetentionChoice(area, days)) return { error: t('checkFields') }
  const { org } = await requireManager()
  const { db, clickhouse } = services()
  const project = await getProjectBySlug(db, org.id, String(formData.get('slug') ?? ''))
  if (!project) return { error: t('notFound') }
  const before = await setAreaRetention(db, org.id, project.id, area, days)
  if (before === null) return { error: t('notFound') }
  if (days < before) {
    const trim = area === 'errors' ? trimErrors : trimLogs
    await trim(clickhouse, org.id, project.id, days).catch(() => {})
  }
  revalidatePath(`/p/${project.slug}`, 'layout')
  revalidatePath(`/all/${area}`)
  return { done: true }
}
