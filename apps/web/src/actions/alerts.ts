'use server'

import {
  acknowledgeIncidents,
  getProjectBySlug,
  INCIDENT_KINDS,
  type IncidentKind,
  listChannels,
  RULE_DEFAULTS,
  resetRule,
  saveRule,
} from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { tellLive } from '@/server/live'
import { requireManager, requireOrg } from '@/server/session'

const LEVELS = ['emergency', 'signal', 'off'] as const

/** Saves one rule for the organization, or for one product when the form sends its slug. */
export async function saveRuleAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org } = await requireManager()
  const { db } = services()
  const kind = String(formData.get('kind') ?? '') as IncidentKind
  if (!INCIDENT_KINDS.includes(kind)) return { error: t('checkFields') }

  const slug = String(formData.get('slug') ?? '')
  let projectId: string | null = null
  if (slug) {
    const project = await getProjectBySlug(db, org.id, slug)
    if (!project) return { error: t('notFound') }
    projectId = project.id
  }
  const path = slug ? `/p/${slug}/settings/rules` : '/settings/alerts'

  if (projectId && formData.get('intent') === 'reset') {
    await resetRule(db, org.id, projectId, kind)
    revalidatePath(path)
    return { done: true }
  }

  const level = String(formData.get('level') ?? '') as (typeof LEVELS)[number]
  if (!LEVELS.includes(level)) return { error: t('checkFields') }

  const params: Record<string, number> = {}
  for (const key of Object.keys(RULE_DEFAULTS[kind].params)) {
    const value = Number(formData.get(`param.${key}`))
    if (!Number.isInteger(value) || value < 0 || value > 1440) return { error: t('checkFields') }
    params[key] = value
  }

  const known = new Set((await listChannels(db, org.id)).map((channel) => channel.id))
  const chosen = formData
    .getAll('channel')
    .map(String)
    .filter((id) => known.has(id))

  const saved = await saveRule(db, org.id, projectId, kind, {
    level,
    params,
    channelIds: chosen.length > 0 ? chosen : null,
  })
  if (!saved) return { error: t('notFound') }
  revalidatePath(path)
  return { done: true }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * "I'm on it": the viewer takes the open emergencies the form lists. Any member
 * can, whoever is on call. Everyone's strip then shows who took them and since
 * when.
 */
export async function onItAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org, user } = await requireOrg()
  const ids = formData
    .getAll('incident')
    .map(String)
    .filter((id) => UUID.test(id))
  if (ids.length === 0) return { error: t('checkFields') }
  const taken = await acknowledgeIncidents(services().db, org.id, ids, user.id, new Date())
  if (taken.length > 0) await tellLive(org.id, 'incidents')
  return { done: true }
}
