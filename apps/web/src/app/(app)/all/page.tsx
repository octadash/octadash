import { listProjects } from '@octadash/db'
import { getTranslations } from 'next-intl/server'
import { FirstProduct } from '@/components/first-product'
import { GetStarted } from '@/components/get-started'
import { parsePeriod } from '@/lib/period'
import { services } from '@/server/context'
import { loadGetStarted } from '@/server/get-started'
import { loadOverview } from '@/server/overview'
import { canManage, requireOrg } from '@/server/session'
import { OverviewView } from '@/views/overview'

/** Overview of every product; with none yet, the first product's form in its place. */
export default async function AllPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>
}) {
  const { org } = await requireOrg()
  const [projects, t, { period }, getStarted] = await Promise.all([
    listProjects(services().db, org.id),
    getTranslations(),
    searchParams,
    loadGetStarted(org),
  ])

  if (projects.length === 0) {
    return <FirstProduct orgName={org.name} canCreate={canManage(org.role)} />
  }

  const overview = await loadOverview(org.id, projects, parsePeriod(period))
  return (
    <OverviewView
      title={t('areas.overview.name')}
      base="/all"
      overview={overview}
      top={getStarted && <GetStarted data={getStarted} />}
    />
  )
}
