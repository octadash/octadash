import { lastUsageEvent, listOrgSources } from '@octadash/db'
import { services } from '@/server/context'
import { getViewer, listMemberships } from '@/server/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** The newest product event of one source: step 4 of Set up Product usage asks until one arrives. */
export async function GET(request: Request) {
  const viewer = await getViewer()
  if (!viewer) return new Response(null, { status: 401 })
  const orgs = await listMemberships(viewer.user.id)
  const org = orgs.find((o) => o.id === viewer.session.activeOrganizationId) ?? orgs[0]
  if (!org) return new Response(null, { status: 403 })
  const id = new URL(request.url).searchParams.get('source') ?? ''
  const { db, clickhouse } = services()
  const source = (await listOrgSources(db, org.id)).find((s) => s.id === id)
  if (!source) return new Response(null, { status: 404 })
  const last = await lastUsageEvent(clickhouse, org.id, source.project_id, source.id).catch(
    () => null,
  )
  return Response.json(last ? { at: last.at.toISOString(), event: last.event } : null, {
    headers: { 'cache-control': 'no-store' },
  })
}
