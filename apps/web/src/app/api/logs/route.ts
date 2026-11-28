import { getOrganizationSettings, listOrgSources, listProjects } from '@octadash/db'
import { parseLogsState } from '@/lib/logs'
import { scopeSources } from '@/lib/source-scope'
import { trafficPeriod } from '@/lib/traffic'
import { services } from '@/server/context'
import { loadLines, scopeProjects } from '@/server/logs'
import { getViewer, listMemberships } from '@/server/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/

/**
 * Lines for the Logs list after the page loaded: `after` the newest on screen
 * (Live) or `before` the oldest ("Load older"). `scope` is `all`, `g:<group>`
 * or `p:<product>`.
 */
export async function GET(request: Request) {
  const viewer = await getViewer()
  if (!viewer) return new Response(null, { status: 401 })
  const orgs = await listMemberships(viewer.user.id)
  const org = orgs.find((o) => o.id === viewer.session.activeOrganizationId) ?? orgs[0]
  if (!org) return new Response(null, { status: 403 })
  const params = new URL(request.url).searchParams
  const projects = await scopeProjects(org.id, params.get('scope') ?? '')
  if (!projects) return new Response(null, { status: 404 })
  const before = params.get('before') ?? undefined
  const after = params.get('after') ?? undefined
  if ((before && !TIME.test(before)) || (after && !TIME.test(after))) {
    return new Response(null, { status: 400 })
  }
  const state = parseLogsState(Object.fromEntries(params))
  const { db } = services()
  const [settings, all, orgSources] = await Promise.all([
    getOrganizationSettings(db, org.id),
    listProjects(db, org.id),
    listOrgSources(db, org.id),
  ])
  const { source } = scopeSources(orgSources, projects, state.source)
  const now = new Date()
  const period = trafficPeriod(state.period, now, settings.timeZone)
  try {
    const lines = await loadLines(
      org.id,
      projects,
      all,
      state.q,
      { from: period.from, to: new Date(now.getTime() + 60_000) },
      { before, after },
      orgSources,
      source ? [source.id] : [],
    )
    return Response.json({ lines }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return new Response(null, { status: 503 })
  }
}
