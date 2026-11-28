import { requireOrg } from '@/server/session'
import { UptimeOverview } from '@/views/uptime-overview'

/** Uptime of every product side by side, the ones down first. */
export default async function AllUptimePage() {
  const { org } = await requireOrg()
  return <UptimeOverview orgId={org.id} projectIds={null} />
}
