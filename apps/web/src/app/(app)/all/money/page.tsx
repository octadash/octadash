import { getTranslations } from 'next-intl/server'
import { parseMoneyState } from '@/lib/money'
import { requireOrg } from '@/server/session'
import { MoneyView } from '@/views/money'

type Search = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata() {
  const t = await getTranslations('moneyArea')
  return { title: `${t('title')} · Octadash` }
}

/** Money of every product. */
export default async function AllMoneyPage({ searchParams }: { searchParams: Search }) {
  const { org } = await requireOrg()
  return (
    <MoneyView
      orgId={org.id}
      projectIds={null}
      path="/all/money"
      scope="all"
      state={parseMoneyState(await searchParams)}
    />
  )
}
