import { listProjects } from '@octadash/db'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { parsePeriod } from '@/lib/period'
import { services } from '@/server/context'
import { loadOverview } from '@/server/overview'
import { requireOrg } from '@/server/session'
import { OverviewView } from '@/views/overview'

/** Overview of every product. */
export default async function AllPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>
}) {
  const { org } = await requireOrg()
  const [projects, t, { period }] = await Promise.all([
    listProjects(services().db, org.id),
    getTranslations(),
    searchParams,
  ])

  if (projects.length === 0) {
    return (
      <Card className="py-10">
        <CardHeader>
          <CardTitle>
            <h1 className="font-display text-xl font-semibold">{t('projects.emptyTitle')}</h1>
          </CardTitle>
          <CardDescription>{t('projects.emptyBody')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/products/new">{t('projects.create')}</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const overview = await loadOverview(org.id, projects, parsePeriod(period))
  return <OverviewView title={t('areas.overview.name')} base="/all" overview={overview} />
}
