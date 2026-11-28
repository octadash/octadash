import { parseUptimePeriod } from '@/lib/uptime-board'
import { canManage, requireOrg } from '@/server/session'
import { UptimeBoardView } from '@/views/uptime-board'

/** Uptime of every product: every monitor, problems first. */
export default async function AllUptimePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { org } = await requireOrg()
  const { period } = await searchParams
  return (
    <UptimeBoardView
      orgId={org.id}
      projectIds={null}
      base="/all"
      periodId={parseUptimePeriod(period)}
      manager={canManage(org.role)}
    />
  )
}
