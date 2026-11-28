import { parseFilters, parseMetric, parseTrafficPeriod } from '@/lib/traffic'
import { requireOrg } from '@/server/session'
import { TrafficView } from '@/views/traffic'

type Search = Promise<{ period?: string; metric?: string; f?: string | string[] }>

/** Traffic of every product. */
export default async function AllTrafficPage({ searchParams }: { searchParams: Search }) {
  const { org } = await requireOrg()
  const { period, metric, f } = await searchParams
  return (
    <TrafficView
      orgId={org.id}
      projectIds={null}
      path="/all/traffic"
      scope="all"
      periodId={parseTrafficPeriod(period)}
      metric={parseMetric(metric)}
      filters={parseFilters(f)}
    />
  )
}
