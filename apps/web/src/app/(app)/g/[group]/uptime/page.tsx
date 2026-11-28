import { requireGroup } from '@/server/group'
import { UptimeOverview } from '@/views/uptime-overview'

/** Uptime of the group's products side by side. */
export default async function GroupUptimePage({ params }: { params: Promise<{ group: string }> }) {
  const { group: slug } = await params
  const { org, group } = await requireGroup(slug)
  return <UptimeOverview orgId={org.id} projectIds={group.project_ids} title={group.name} />
}
