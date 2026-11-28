import { getTranslations } from 'next-intl/server'
import { parseMoneyState } from '@/lib/money'
import { requireGroup } from '@/server/group'
import { MoneyView } from '@/views/money'

type Search = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata() {
  const t = await getTranslations('moneyArea')
  return { title: `${t('title')} · Octadash` }
}

/** Money of a group's products: the same page, filtered. */
export default async function GroupMoneyPage({
  params,
  searchParams,
}: {
  params: Promise<{ group: string }>
  searchParams: Search
}) {
  const { group: slug } = await params
  const { org, group } = await requireGroup(slug)
  return (
    <MoneyView
      orgId={org.id}
      projectIds={group.project_ids}
      path={`/g/${group.slug}/money`}
      scope={`g:${group.slug}`}
      state={parseMoneyState(await searchParams)}
      group={group.name}
    />
  )
}
