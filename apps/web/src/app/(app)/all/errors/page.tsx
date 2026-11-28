import { getTranslations } from 'next-intl/server'
import { parseErrorsState } from '@/lib/errors'
import { requireOrg } from '@/server/session'
import { ErrorsView } from '@/views/errors'

type Search = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata() {
  const t = await getTranslations('errorsArea')
  return { title: `${t('title')} · Octadash` }
}

/** Errors of every product. */
export default async function AllErrorsPage({ searchParams }: { searchParams: Search }) {
  const { org, user } = await requireOrg()
  return (
    <ErrorsView
      orgId={org.id}
      userId={user.id}
      projectIds={null}
      path="/all/errors"
      state={parseErrorsState(await searchParams)}
    />
  )
}
