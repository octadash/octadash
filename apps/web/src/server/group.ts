import { getGroupBySlug, listProjects } from '@octadash/db'
import { notFound } from 'next/navigation'
import { services } from './context'
import { requireOrg } from './session'

/** The group in the URL with its products, or a 404. */
export async function requireGroup(slug: string) {
  const { org } = await requireOrg()
  const { db } = services()
  const [group, projects] = await Promise.all([
    getGroupBySlug(db, org.id, slug),
    listProjects(db, org.id),
  ])
  if (!group) notFound()
  return {
    org,
    group,
    projects: projects.filter((project) => group.project_ids.includes(project.id)),
    allProjects: projects,
  }
}
