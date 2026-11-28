'use server'

import { getProjectBySlug, isArea, setProjectArea } from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

async function setArea(formData: FormData, state: 'dismissed' | null) {
  const { org } = await requireManager()
  const slug = String(formData.get('slug') ?? '')
  const area = String(formData.get('area') ?? '')
  if (!isArea(area)) return
  const { db } = services()
  const project = await getProjectBySlug(db, org.id, slug)
  if (!project) return
  await setProjectArea(db, org.id, project.id, area, state)
  revalidatePath(`/p/${project.slug}`)
}

/** "I won't use this": the card moves to "Also available for this product". */
export async function dismissAreaAction(formData: FormData) {
  await setArea(formData, 'dismissed')
}

/** "Use again": the area goes back to "not set up". */
export async function restoreAreaAction(formData: FormData) {
  await setArea(formData, null)
}
