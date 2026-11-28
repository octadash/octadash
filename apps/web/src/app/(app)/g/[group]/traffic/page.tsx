import { parseFilters, parseMetric, parseTrafficPeriod } from '@/lib/traffic'
import { requireGroup } from '@/server/group'
import { TrafficView } from '@/views/traffic'

type Search = Promise<{ period?: string; metric?: string; f?: string | string[] }>

/** Traffic of a group's products: the same page, filtered. */
export default async function GroupTrafficPage({
  params,
  searchParams,
}: {
  params: Promise<{ group: string }>
  searchParams: Search
}) {
  const { group: slug } = await params
  const { period, metric, f } = await searchParams
  const { org, group } = await requireGroup(slug)
  return (
    <TrafficView
      orgId={org.id}
      projectIds={group.project_ids}
      path={`/g/${group.slug}/traffic`}
      scope={`g:${group.slug}`}
      periodId={parseTrafficPeriod(period)}
      metric={parseMetric(metric)}
      filters={parseFilters(f)}
      group={group.name}
    />
  )
}
