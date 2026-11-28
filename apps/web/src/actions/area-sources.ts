'use server'

import {
  addSourceArea,
  createSource,
  getProjectBySlug,
  listSources,
  setProjectArea,
} from '@octadash/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { isSourceArea, SOURCE_AREA_PLATFORMS } from '@/lib/source-areas'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

async function productOf(formData: FormData) {
  const { org } = await requireManager()
  const area = String(formData.get('area') ?? '')
  if (!isSourceArea(area)) return null
  const project = await getProjectBySlug(services().db, org.id, String(formData.get('slug') ?? ''))
  return project ? { org, project, area } : null
}

/**
 * The first step of an empty area page: one click on where the code runs
 * makes a source for the area, named after the platform (Site for the page
 * script), and the page shows its code and waits for the first data.
 */
export async function startAreaAction(formData: FormData) {
  const found = await productOf(formData)
  if (!found) return
  const platform = String(formData.get('platform') ?? '')
  const platforms: readonly string[] = SOURCE_AREA_PLATFORMS[found.area]
  if (!platforms.includes(platform)) return
  const { db } = services()
  const [tp, ts] = await Promise.all([getTranslations('platforms'), getTranslations('areaStart')])
  const source = await createSource(db, found.org.id, found.project.id, {
    name: platform === 'html' ? ts('siteName') : tp(platform as 'html'),
    platform,
    areas: [found.area],
  })
  if (!source) return
  await setProjectArea(db, found.org.id, found.project.id, found.area, 'set_up')
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  redirect(`/p/${found.project.slug}/${found.area}`)
}

/** "Use {source}": a source that already sends something else feeds this area too. */
export async function adoptSourceAction(formData: FormData) {
  const found = await productOf(formData)
  if (!found) return
  const id = String(formData.get('source') ?? '')
  const { db } = services()
  const sources = await listSources(db, found.org.id, found.project.id)
  if (!sources.some((s) => s.id === id)) return
  await addSourceArea(db, found.org.id, id, found.area)
  await setProjectArea(db, found.org.id, found.project.id, found.area, 'set_up')
  revalidatePath(`/p/${found.project.slug}`, 'layout')
  redirect(`/p/${found.project.slug}/${found.area}`)
}
