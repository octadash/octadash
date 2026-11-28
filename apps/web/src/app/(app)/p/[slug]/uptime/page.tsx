import { getProjectBySlug } from '@octadash/db'
import { notFound } from 'next/navigation'
import { parseUptimePeriod } from '@/lib/uptime-board'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'
import { UptimeBoardView } from '@/views/uptime-board'

/** Uptime of one product: the board of every product, filtered to it, its monitors open. */
export default async function ProductUptimePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ period?: string }>
}) {
  const { slug } = await params
  const { period } = await searchParams
  const { org } = await requireOrg()
  const project = await getProjectBySlug(services().db, org.id, slug)
  if (!project) notFound()
  return (
    <UptimeBoardView
      orgId={org.id}
      projectIds={[project.id]}
      base={`/p/${project.slug}`}
      periodId={parseUptimePeriod(period)}
      manager={canManage(org.role)}
      single={{ slug: project.slug }}
    />
  )
}
