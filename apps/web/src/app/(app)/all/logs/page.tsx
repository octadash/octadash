import { getTranslations } from 'next-intl/server'
import { parseLogsState } from '@/lib/logs'
import { canManage, requireOrg } from '@/server/session'
import { LogsView } from '@/views/logs'

type Search = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata() {
  const t = await getTranslations('logsArea')
  return { title: `${t('title')} · Octadash` }
}

/** Logs of every product. */
export default async function AllLogsPage({ searchParams }: { searchParams: Search }) {
  const { org } = await requireOrg()
  return (
    <LogsView
      orgId={org.id}
      projectIds={null}
      path="/all/logs"
      scope="all"
      state={parseLogsState(await searchParams)}
      canManage={canManage(org.role)}
    />
  )
}
