import { getTranslations } from 'next-intl/server'
import { parseErrorsState } from '@/lib/errors'
import { requireGroup } from '@/server/group'
import { requireOrg } from '@/server/session'
import { ErrorsView } from '@/views/errors'

type Search = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata() {
  const t = await getTranslations('errorsArea')
  return { title: `${t('title')} · Octadash` }
}

/** Errors of a group's products: the same page, filtered. */
export default async function GroupErrorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ group: string }>
  searchParams: Search
}) {
  const { group: slug } = await params
  const [{ org, group }, { user }] = await Promise.all([requireGroup(slug), requireOrg()])
  return (
    <ErrorsView
      orgId={org.id}
      userId={user.id}
      projectIds={group.project_ids}
      path={`/g/${group.slug}/errors`}
      state={parseErrorsState(await searchParams)}
      group={group.name}
    />
  )
}
