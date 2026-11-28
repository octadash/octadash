import { getProjectBySlug } from '@octadash/db'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { parseMoneyState } from '@/lib/money'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'
import { MoneyView } from '@/views/money'

type Search = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata() {
  const t = await getTranslations('moneyArea')
  return { title: `${t('title')} · Octadash` }
}

/** Money of one product; before a gateway is connected, how to connect one. */
export default async function ProductMoneyPage({
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
    <MoneyView
      orgId={org.id}
      projectIds={[project.id]}
      path={`/p/${project.slug}/money`}
      scope={`p:${project.slug}`}
      state={parseMoneyState(await searchParams)}
      product={{ name: project.name, slug: project.slug }}
    />
  )
}
