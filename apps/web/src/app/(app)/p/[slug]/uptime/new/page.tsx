import { getOrganizationSettings, getProjectBySlug } from '@octadash/db'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { MonitorFormPage } from '@/components/monitor-form-page'
import { services } from '@/server/context'
import { requireManager } from '@/server/session'

/** Uptime › Add monitor, for one product. */
export default async function NewMonitorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { org } = await requireManager()
  const { db } = services()
  const [project, settings, t] = await Promise.all([
    getProjectBySlug(db, org.id, slug),
    getOrganizationSettings(db, org.id),
    getTranslations('monitorForm'),
  ])
  if (!project) notFound()
  return (
    <>
      <div className="flex max-w-2xl flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">{t('addTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <MonitorFormPage
        orgId={org.id}
        project={{ id: project.id, name: project.name, slug: project.slug }}
        values={{}}
        timeZone={settings.timeZone}
      >
        <p className="text-sm text-muted-foreground">{t('waitingNew')}</p>
      </MonitorFormPage>
    </>
  )
}
