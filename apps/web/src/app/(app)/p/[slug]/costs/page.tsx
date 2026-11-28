import { getProjectBySlug } from '@octadash/db'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { parseCostsState } from '@/lib/costs'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'
import { CostsView } from '@/views/costs'

type Search = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata() {
  const t = await getTranslations('costsArea')
  return { title: `${t('title')} · Octadash` }
}

/** Costs of one product; before a cost is connected, how to connect one. */
export default async function ProductCostsPage({
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
    <CostsView
      orgId={org.id}
      projectIds={[project.id]}
      path={`/p/${project.slug}/costs`}
      state={parseCostsState(await searchParams)}
      product={{ name: project.name, slug: project.slug }}
    />
  )
}
