import { parseUptimePeriod } from '@/lib/uptime-board'
import { requireGroup } from '@/server/group'
import { canManage } from '@/server/session'
import { UptimeBoardView } from '@/views/uptime-board'

/** Uptime of the group's products: the same board, filtered. */
export default async function GroupUptimePage({
  params,
  searchParams,
}: {
  params: Promise<{ group: string }>
  searchParams: Promise<{ period?: string }>
}) {
  const { group: slug } = await params
  const { period } = await searchParams
  const { org, group } = await requireGroup(slug)
  return (
    <UptimeBoardView
      orgId={org.id}
      projectIds={group.project_ids}
      base={`/g/${group.slug}`}
      periodId={parseUptimePeriod(period)}
      title={group.name}
      manager={canManage(org.role)}
    />
  )
}
