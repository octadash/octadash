import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { TvButton } from '@/components/tv-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { parsePeriod } from '@/lib/period'
import { requireGroup } from '@/server/group'
import { loadOverview } from '@/server/overview'
import { canManage } from '@/server/session'
import { OverviewView } from '@/views/overview'

/** Overview of one group: the same page as every product, filtered to the group. */
export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ group: string }>
  searchParams: Promise<{ period?: string | string[] }>
}) {
  const [{ group: slug }, { period }] = await Promise.all([params, searchParams])
  const { org, group, projects } = await requireGroup(slug)
  const t = await getTranslations()
  const edit = canManage(org.role) && (
    <Button asChild variant="outline">
      <Link href={`/g/${group.slug}/settings`}>{t('groups.edit')}</Link>
    </Button>
  )
  if (projects.length === 0) {
    return (
      <>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-display text-3xl font-semibold">{group.name}</h1>
          {edit}
        </div>
        <Card>
          <CardContent className="text-sm text-muted-foreground">{t('groups.empty')}</CardContent>
        </Card>
      </>
    )
  }
  const overview = await loadOverview(org.id, projects, parsePeriod(period))
  return (
    <OverviewView
      title={group.name}
      base={`/g/${group.slug}`}
      overview={overview}
      action={
        <>
          <TvButton scope={`g:${group.slug}`} />
          {edit}
        </>
      }
    />
  )
}
