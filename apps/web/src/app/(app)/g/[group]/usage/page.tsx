import { getTranslations } from 'next-intl/server'
import { parseUsageState } from '@/lib/usage'
import { requireGroup } from '@/server/group'
import { UsageView } from '@/views/usage'

type Search = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata() {
  const t = await getTranslations('usageArea')
  return { title: `${t('title')} · Octadash` }
}

/** Product usage of a group's products: the same page, filtered. */
export default async function GroupUsagePage({
  params,
  searchParams,
}: {
  params: Promise<{ group: string }>
  searchParams: Search
}) {
  const { group: slug } = await params
  const { org, group } = await requireGroup(slug)
  return (
    <UsageView
      orgId={org.id}
      projectIds={group.project_ids}
      path={`/g/${group.slug}/usage`}
      state={parseUsageState(await searchParams)}
      group={group.name}
    />
  )
}
