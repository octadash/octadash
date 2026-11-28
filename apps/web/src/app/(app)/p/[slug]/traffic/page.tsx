import { getProjectBySlug } from '@octadash/db'
import { notFound } from 'next/navigation'
import { parseFilters, parseMetric, parseTrafficPeriod } from '@/lib/traffic'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'
import { TrafficView } from '@/views/traffic'

type Search = Promise<{ period?: string; metric?: string; f?: string | string[] }>

/** Traffic of one product; before any source sends page views, the way to set it up. */
export default async function ProductTrafficPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Search
}) {
  const { slug } = await params
  const { period, metric, f } = await searchParams
  const { org } = await requireOrg()
  const project = await getProjectBySlug(services().db, org.id, slug)
  if (!project) notFound()
  return (
    <TrafficView
      orgId={org.id}
      projectIds={[project.id]}
      path={`/p/${project.slug}/traffic`}
      scope={`p:${project.slug}`}
      periodId={parseTrafficPeriod(period)}
      metric={parseMetric(metric)}
      filters={parseFilters(f)}
      product={{ name: project.name, slug: project.slug }}
    />
  )
}
