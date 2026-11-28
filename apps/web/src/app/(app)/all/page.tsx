import { listProjects } from '@octadash/db'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'
import { ProductsOverview } from '@/views/products-overview'

/** Overview of every product. */
export default async function AllPage() {
  const { org } = await requireOrg()
  const [projects, t] = await Promise.all([listProjects(services().db, org.id), getTranslations()])

  if (projects.length === 0) {
    return (
      <Card className="py-10">
        <CardHeader>
          <CardTitle>
            <h1 className="font-display text-xl font-semibold">{t('projects.emptyTitle')}</h1>
          </CardTitle>
          <CardDescription>{t('projects.emptyBody')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/products/new">{t('projects.create')}</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <ProductsOverview
      title={t('areas.overview.name')}
      subtitle={t('overview.count', { count: projects.length })}
      projects={projects}
    />
  )
}
