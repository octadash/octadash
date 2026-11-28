import { getProjectBySlug } from '@octadash/db'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { parseErrorsState } from '@/lib/errors'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'
import { ErrorsView } from '@/views/errors'

type Search = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata() {
  const t = await getTranslations('errorsArea')
  return { title: `${t('title')} · Octadash` }
}

/** Errors of one product; before any error arrives, how to send them. */
export default async function ProductErrorsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Search
}) {
  const { slug } = await params
  const { org, user } = await requireOrg()
  const project = await getProjectBySlug(services().db, org.id, slug)
  if (!project) notFound()
  return (
    <ErrorsView
      orgId={org.id}
      userId={user.id}
      projectIds={[project.id]}
      path={`/p/${project.slug}/errors`}
      state={parseErrorsState(await searchParams)}
      product={{ name: project.name, slug: project.slug }}
    />
  )
}
