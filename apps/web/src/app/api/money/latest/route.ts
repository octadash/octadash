import { scopeProjects } from '@/server/logs'
import { loadLatestPayments } from '@/server/money'
import { getViewer, listMemberships } from '@/server/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** The newest payments of a scope (`all`, `g:<slug>`, `p:<slug>`), for the live list on Money. */
export async function GET(request: Request) {
  const viewer = await getViewer()
  if (!viewer) return new Response(null, { status: 401 })
  const orgs = await listMemberships(viewer.user.id)
  const org = orgs.find((o) => o.id === viewer.session.activeOrganizationId) ?? orgs[0]
  if (!org) return new Response(null, { status: 403 })
  const scope = new URL(request.url).searchParams.get('scope') ?? 'all'
  const projects = await scopeProjects(org.id, scope)
  if (!projects) return new Response(null, { status: 404 })
  const payments = await loadLatestPayments(org.id, projects)
  return Response.json(payments.map((p) => ({ ...p, at: p.at.toISOString() })))
}
