import { listOrgMonitors, listProjects } from '@octadash/db'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { StatusDot } from '@/components/status-dot'
import { services } from '@/server/context'
import { formatUptime, productUptime, safeMonitorStats } from '@/server/uptime-view'

const ORDER = { down: 0, unknown: 1, up: 2, none: 3 } as const

/**
 * Uptime of several products side by side, the ones down first: every product
 * of the organization, or the products of one group (`projectIds`).
 */
export async function UptimeOverview({
  orgId,
  projectIds,
  title,
}: {
  orgId: string
  projectIds: string[] | null
  title?: string
}) {
  const { db, clickhouse } = services()
  const [allProjects, allMonitors] = await Promise.all([
    listProjects(db, orgId),
    listOrgMonitors(db, orgId),
  ])
  const keep = (id: string) => projectIds === null || projectIds.includes(id)
  const projects = allProjects.filter((project) => keep(project.id))
  const monitors = allMonitors.filter((monitor) => keep(monitor.project_id))
  const [stats, t] = await Promise.all([
    safeMonitorStats(
      clickhouse,
      orgId,
      monitors.map((m) => m.id),
    ),
    getTranslations('uptime'),
  ])
  const rows = projects
    .map((project) => ({
      project,
      summary: productUptime(
        monitors.filter((m) => m.project_id === project.id),
        stats,
      ),
    }))
    .sort(
      (a, b) =>
        ORDER[a.summary.status] - ORDER[b.summary.status] ||
        a.project.name.localeCompare(b.project.name),
    )

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">
          {title ? `${t('title')} · ${title}` : t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-3 font-medium" />
              <th className="px-4 py-3 text-right font-medium">{t('uptime30')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('response')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('certificate')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ project, summary }) => (
              <tr
                key={project.id}
                className={
                  summary.status === 'down'
                    ? 'border-b border-border bg-error/10 last:border-0'
                    : 'border-b border-border last:border-0'
                }
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/p/${project.slug}/uptime`}
                    className="flex items-center gap-3 font-medium hover:text-brand"
                  >
                    <StatusDot status={summary.status} />
                    {project.name}
                    <span className="font-normal text-muted-foreground">
                      {summary.monitors === 0
                        ? t('noMonitors')
                        : t('monitors', { count: summary.monitors })}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {formatUptime(summary.uptime)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {summary.medianMs === null ? '–' : `${summary.medianMs} ms`}
                </td>
                <td
                  className={
                    summary.certDays !== null && summary.certDays <= 14
                      ? 'px-4 py-3 text-right font-medium text-warn tabular-nums'
                      : 'px-4 py-3 text-right tabular-nums'
                  }
                >
                  {summary.certDays === null ? '–' : t('certDays', { count: summary.certDays })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
