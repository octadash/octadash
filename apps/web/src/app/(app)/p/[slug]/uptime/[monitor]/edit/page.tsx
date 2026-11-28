import { getMonitor, getOrganizationSettings, getProjectBySlug } from '@octadash/db'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { HeartbeatCalls } from '@/components/heartbeat-calls'
import { MonitorFormPage } from '@/components/monitor-form-page'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'
import { safeMonitorStats } from '@/server/uptime-view'

/** Uptime › Edit monitor. A heartbeat just added waits here for its first call. */
export default async function EditMonitorPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; monitor: string }>
  searchParams: Promise<{ added?: string }>
}) {
  const { slug, monitor: monitorId } = await params
  const { added } = await searchParams
  const { org } = await requireManager()
  const { db, clickhouse } = services()
  const [project, monitor, settings, t] = await Promise.all([
    getProjectBySlug(db, org.id, slug),
    getMonitor(db, org.id, monitorId),
    getOrganizationSettings(db, org.id),
    getTranslations('monitorForm'),
  ])
  if (!project || !monitor || monitor.project_id !== project.id) notFound()
  const stats =
    monitor.kind === 'heartbeat'
      ? (await safeMonitorStats(clickhouse, org.id, [monitor.id])).get(monitor.id)
      : undefined

  return (
    <>
      <div className="flex max-w-2xl flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">
          {t('editTitle', { name: monitor.name })}
        </h1>
        {added && (
          <p role="status" className="text-sm text-ok">
            {t('added')}
          </p>
        )}
      </div>
      <MonitorFormPage
        orgId={org.id}
        project={{ id: project.id, name: project.name, slug: project.slug }}
        timeZone={settings.timeZone}
        values={{
          id: monitor.id,
          name: monitor.name,
          kind: monitor.kind,
          url: monitor.url ?? '',
          interval: monitor.interval_seconds,
          timeout: monitor.timeout_seconds,
          grace: monitor.grace_seconds,
          schedule: monitor.schedule,
          token: monitor.heartbeat_token ?? undefined,
        }}
      >
        {monitor.kind === 'heartbeat' && (
          <HeartbeatCalls
            lastAt={stats?.lastAt?.toISOString() ?? null}
            lastUp={stats?.lastUp ?? null}
            labels={{
              waiting: t('waiting'),
              lastCall: t('lastCall', { when: '{when}' }),
              lastFail: t('lastFail', { when: '{when}' }),
            }}
          />
        )}
      </MonitorFormPage>
    </>
  )
}
