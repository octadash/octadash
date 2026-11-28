'use server'

import { addIncidentNote, closeIncident, takeIncidents } from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import type { FormState } from '@/components/action-form'
import { services } from '@/server/context'
import { tellLive } from '@/server/live'
import { requireOrg } from '@/server/session'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOTE_MAX = 2000

/**
 * "Take over" on one emergency, or "I'm on these too" on the ones ticked
 * beside it. Any member can: whoever is awake fixes it.
 */
export async function takeEmergenciesAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org, user } = await requireOrg()
  const ids = formData
    .getAll('incident')
    .map(String)
    .filter((id) => UUID.test(id))
  if (ids.length === 0) return { error: t('pickOne') }
  const taken = await takeIncidents(services().db, org.id, ids, user.id, new Date())
  if (taken.length > 0) await tellLive(org.id, 'incidents')
  revalidatePath('/', 'layout')
  return { done: true }
}

/** A team note on the emergency's record. */
export async function addNoteAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org, user } = await requireOrg()
  const id = String(formData.get('incident') ?? '')
  const body = String(formData.get('note') ?? '').trim()
  if (!UUID.test(id) || !body) return { error: t('writeNote') }
  if (body.length > NOTE_MAX) return { error: t('noteTooLong', { max: NOTE_MAX }) }
  const added = await addIncidentNote(services().db, org.id, id, user.id, body, new Date())
  if (!added) return { error: t('checkFields') }
  await tellLive(org.id, 'incidents')
  revalidatePath('/', 'layout')
  return { done: true }
}

/** "Close anyway": ends it by hand, with why, for a false alarm or a fix the checks don't see yet. */
export async function closeEmergencyAction(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getTranslations('errors')
  const { org, user } = await requireOrg()
  const id = String(formData.get('incident') ?? '')
  const note = String(formData.get('note') ?? '').trim()
  if (!UUID.test(id) || !note) return { error: t('writeWhy') }
  if (note.length > NOTE_MAX) return { error: t('noteTooLong', { max: NOTE_MAX }) }
  await closeIncident(services().db, org.id, id, user.id, note, new Date())
  await tellLive(org.id, 'incidents')
  revalidatePath('/', 'layout')
  return { done: true }
}
