import { getTranslations } from 'next-intl/server'
import { parseUsageState } from '@/lib/usage'
import { requireOrg } from '@/server/session'
import { UsageView } from '@/views/usage'

type Search = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata() {
  const t = await getTranslations('usageArea')
  return { title: `${t('title')} · Octadash` }
}

/** Product usage of every product. */
export default async function AllUsagePage({ searchParams }: { searchParams: Search }) {
  const { org } = await requireOrg()
  return (
    <UsageView
      orgId={org.id}
      projectIds={null}
      path="/all/usage"
      state={parseUsageState(await searchParams)}
    />
  )
}
