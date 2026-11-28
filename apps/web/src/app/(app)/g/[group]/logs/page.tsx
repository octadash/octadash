import { getTranslations } from 'next-intl/server'
import { parseLogsState } from '@/lib/logs'
import { requireGroup } from '@/server/group'
import { canManage } from '@/server/session'
import { LogsView } from '@/views/logs'

type Search = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata() {
  const t = await getTranslations('logsArea')
  return { title: `${t('title')} · Octadash` }
}

/** Logs of a group's products: the same page, filtered. */
export default async function GroupLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ group: string }>
  searchParams: Search
}) {
  const { group: slug } = await params
  const { org, group } = await requireGroup(slug)
  return (
    <LogsView
      orgId={org.id}
      projectIds={group.project_ids}
      path={`/g/${group.slug}/logs`}
      scope={`g:${group.slug}`}
      state={parseLogsState(await searchParams)}
      canManage={canManage(org.role)}
    />
  )
}
