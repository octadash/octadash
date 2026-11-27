import { listProjects } from '@octadash/db'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
      <Card className="py-10">
        <CardHeader>
          <CardTitle>
            <h1 className="font-display text-xl font-semibold">{t('emptyTitle')}</h1>
          </CardTitle>
          <CardDescription>{t('emptyBody')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/products/new">{t('create')}</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <Link key={project.id} href={`/p/${project.slug}`} className="group rounded-xl">
          <Card className="h-full transition-shadow group-hover:ring-brand/60">
            <CardHeader>
              <CardTitle className="font-display text-lg font-semibold">{project.name}</CardTitle>
              <CardDescription className="truncate">
                {project.url ? project.url.replace(/^https?:\/\//, '') : t('noUrl')}
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  )
}
