import { listProjects } from '@octadash/db'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Card } from '@/components/ui'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'

export default async function AllPage() {
  const { org } = await requireOrg()
  const [projects, t] = await Promise.all([
    listProjects(services().db, org.id),
    getTranslations('projects'),
  ])

  if (projects.length === 0) {
    return (
      <Card className="flex flex-col items-start gap-3 py-10">
        <h1 className="font-display text-xl font-semibold">{t('emptyTitle')}</h1>
        <p className="text-sm text-muted">{t('emptyBody')}</p>
        <Link
          href="/products/new"
          className="inline-flex h-9 items-center rounded-lg bg-magenta-500 px-4 text-sm font-medium text-white hover:bg-magenta-600"
        >
          {t('create')}
        </Link>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <Link key={project.id} href={`/p/${project.slug}`} className="group">
          <Card className="flex h-full flex-col gap-1 transition-colors group-hover:border-accent">
            <h2 className="font-display text-lg font-semibold">{project.name}</h2>
            <p className="truncate text-sm text-muted">
              {project.url ? project.url.replace(/^https?:\/\//, '') : t('noUrl')}
            </p>
          </Card>
        </Link>
      ))}
    </div>
  )
}
