import { getTranslations } from 'next-intl/server'
import { parseCostsState } from '@/lib/costs'
import { requireGroup } from '@/server/group'
import { CostsView } from '@/views/costs'

type Search = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata() {
  const t = await getTranslations('costsArea')
  return { title: `${t('title')} · Octadash` }
}

/** Costs of a group's products: the same page, filtered. */
export default async function GroupCostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ group: string }>
  searchParams: Search
}) {
  const { group: slug } = await params
  const { org, group } = await requireGroup(slug)
  return (
    <CostsView
      orgId={org.id}
      projectIds={group.project_ids}
      path={`/g/${group.slug}/costs`}
      state={parseCostsState(await searchParams)}
      group={group.name}
    />
  )
}
