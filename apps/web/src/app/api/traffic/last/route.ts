import { lastPageview, listTrafficSources } from '@octadash/db'
import { services } from '@/server/context'
import { getViewer, listMemberships } from '@/server/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** The newest page view of one source: step 3 of Set up Traffic asks until one arrives. */
export async function GET(request: Request) {
  const viewer = await getViewer()
  if (!viewer) return new Response(null, { status: 401 })
  const orgs = await listMemberships(viewer.user.id)
  const org = orgs.find((o) => o.id === viewer.session.activeOrganizationId) ?? orgs[0]
  if (!org) return new Response(null, { status: 403 })
  const id = new URL(request.url).searchParams.get('source') ?? ''
  const { db, clickhouse } = services()
  const sources = await listTrafficSources(db, org.id)
  if (!sources.some((s) => s.id === id)) return new Response(null, { status: 404 })
  const last = await lastPageview(clickhouse, org.id, id).catch(() => null)
  return Response.json(last ? { at: last.at.toISOString(), path: last.path } : null, {
    headers: { 'cache-control': 'no-store' },
  })
}
