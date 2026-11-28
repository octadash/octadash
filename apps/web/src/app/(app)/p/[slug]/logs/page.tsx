import { getProjectBySlug } from '@octadash/db'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { parseLogsState } from '@/lib/logs'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'
import { LogsView } from '@/views/logs'

type Search = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata() {
  const t = await getTranslations('logsArea')
  return { title: `${t('title')} · Octadash` }
}

/** Logs of one product; before any line arrives, how to send them. */
export default async function ProductLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Search
}) {
  const { slug } = await params
  const { org } = await requireOrg()
  const project = await getProjectBySlug(services().db, org.id, slug)
  if (!project) notFound()
  return (
    <LogsView
      orgId={org.id}
      projectIds={[project.id]}
      path={`/p/${project.slug}/logs`}
      scope={`p:${project.slug}`}
      state={parseLogsState(await searchParams)}
      canManage={canManage(org.role)}
      product={{ name: project.name, slug: project.slug }}
    />
  )
}
