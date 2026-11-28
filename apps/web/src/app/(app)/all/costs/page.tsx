import { getTranslations } from 'next-intl/server'
import { parseCostsState } from '@/lib/costs'
import { requireOrg } from '@/server/session'
import { CostsView } from '@/views/costs'

type Search = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata() {
  const t = await getTranslations('costsArea')
  return { title: `${t('title')} · Octadash` }
}

/** Costs of every product. */
export default async function AllCostsPage({ searchParams }: { searchParams: Search }) {
  const { org } = await requireOrg()
  return (
    <CostsView
      orgId={org.id}
      projectIds={null}
      path="/all/costs"
      state={parseCostsState(await searchParams)}
    />
  )
}
