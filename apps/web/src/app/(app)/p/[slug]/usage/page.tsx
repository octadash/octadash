import { getProjectBySlug } from '@octadash/db'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { parseUsageState } from '@/lib/usage'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'
import { UsageView } from '@/views/usage'

type Search = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata() {
  const t = await getTranslations('usageArea')
  return { title: `${t('title')} · Octadash` }
}

/** Product usage of one product; before any event arrives, how to send them. */
export default async function ProductUsagePage({
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
    <UsageView
      orgId={org.id}
      projectIds={[project.id]}
      path={`/p/${project.slug}/usage`}
      state={parseUsageState(await searchParams)}
      product={{ name: project.name, slug: project.slug }}
    />
  )
}
