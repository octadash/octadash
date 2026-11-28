import {
  getGroupBySlug,
  getOrganizationSettings,
  getProjectBySlug,
  listProjects,
  type TrafficDimension,
  trafficBreakdown,
} from '@octadash/db'
import { FILTER_DIMENSIONS, parseFilters, parseTrafficPeriod, trafficPeriod } from '@/lib/traffic'
import { services } from '@/server/context'
import { getViewer, listMemberships } from '@/server/session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Rows per "Load more". */
const PAGE = 50
/** A CSV export carries at most this many rows. */
const CSV_MAX = 10_000

function csvCell(value: string | number) {
  const text = String(value)
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/**
 * "Details" of a Traffic list: every value of one dimension, with search, more
 * rows on demand and a CSV export. Same scope, period and filters as the page.
 * `scope` is `all`, `g:<group>` or `p:<product>`.
 */
export async function GET(request: Request) {
  const viewer = await getViewer()
  if (!viewer) return new Response(null, { status: 401 })
  const orgs = await listMemberships(viewer.user.id)
  const org = orgs.find((o) => o.id === viewer.session.activeOrganizationId) ?? orgs[0]
  if (!org) return new Response(null, { status: 403 })

  const url = new URL(request.url)
  const dimension = url.searchParams.get('dimension') ?? ''
  if (!(FILTER_DIMENSIONS as readonly string[]).includes(dimension)) {
    return Response.json({ error: 'dimension' }, { status: 400 })
  }
  const { db, clickhouse } = services()
  const scope = url.searchParams.get('scope') ?? 'all'
  let projectIds: string[] | null = null
  if (scope.startsWith('g:')) {
    const group = await getGroupBySlug(db, org.id, scope.slice(2))
    if (!group) return new Response(null, { status: 404 })
    projectIds = group.project_ids
  } else if (scope.startsWith('p:')) {
    const project = await getProjectBySlug(db, org.id, scope.slice(2))
    if (!project) return new Response(null, { status: 404 })
    projectIds = [project.id]
  } else {
    projectIds = (await listProjects(db, org.id)).map((p) => p.id)
  }

  const settings = await getOrganizationSettings(db, org.id)
  const period = trafficPeriod(
    parseTrafficPeriod(url.searchParams.get('period') ?? undefined),
    new Date(),
    settings.timeZone,
  )
  const csv = url.searchParams.get('format') === 'csv'
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
  const rows = await trafficBreakdown(
    clickhouse,
    {
      orgId: org.id,
      projectIds,
      from: period.from,
      to: period.to,
      timeZone: settings.timeZone,
      filters: parseFilters(url.searchParams.getAll('f')),
    },
    dimension as TrafficDimension,
    {
      limit: csv ? CSV_MAX : PAGE + 1,
      offset: csv ? 0 : offset,
      search: (url.searchParams.get('search') ?? '').slice(0, 200),
      byProduct: projectIds.length > 1,
    },
  )

  if (csv) {
    const names = new Map((await listProjects(db, org.id)).map((p) => [p.id, p.name]))
    const lines = [
      [
        dimension,
        ...(projectIds.length > 1 && (dimension === 'page' || dimension === 'entry')
          ? ['product']
          : []),
        'visitors',
        'pageviews',
      ].join(','),
      ...rows.map((row) =>
        [
          dimension === 'product' ? (names.get(row.value) ?? row.value) : row.value,
          ...(row.product !== undefined ? [names.get(row.product) ?? row.product] : []),
          row.visitors,
          row.pageviews,
        ]
          .map(csvCell)
          .join(','),
      ),
    ]
    return new Response(`${lines.join('\n')}\n`, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="traffic-${dimension}.csv"`,
      },
    })
  }
  return Response.json({ rows: rows.slice(0, PAGE), more: rows.length > PAGE })
}
