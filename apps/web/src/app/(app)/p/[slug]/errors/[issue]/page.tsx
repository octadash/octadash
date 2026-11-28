import { getProjectBySlug } from '@octadash/db'
import { notFound } from 'next/navigation'
import { issueTitle } from '@/lib/errors'
import { services } from '@/server/context'
import { loadIssue } from '@/server/errors'
import { requireOrg } from '@/server/session'
import { ErrorIssueView } from '@/views/error-issue'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EVENT = /^[0-9a-f]{32}$/

type Params = Promise<{ slug: string; issue: string }>

async function load(params: Params, eventId?: string) {
  const { slug, issue } = await params
  if (!UUID.test(issue)) notFound()
  const { org, user } = await requireOrg()
  const project = await getProjectBySlug(services().db, org.id, slug)
  if (!project) notFound()
  const data = await loadIssue(org.id, issue, eventId)
  if (!data || data.product.id !== project.id) notFound()
  return { data, user }
}

export async function generateMetadata({ params }: { params: Params }) {
  const { data } = await load(params)
  return { title: `${issueTitle(data.issue)} · Octadash` }
}

/** One issue of one product. `?event=` shows an older event. */
export default async function IssuePage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: Promise<{ event?: string }>
}) {
  const { event } = await searchParams
  const { data, user } = await load(params, event && EVENT.test(event) ? event : undefined)
  return (
    <ErrorIssueView
      data={data}
      userId={user.id}
      origin={services().env.OCTADASH_URL.replace(/\/$/, '')}
    />
  )
}
