import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { requireGroup } from '@/server/group'
import { canManage } from '@/server/session'
import { ProductsOverview } from '@/views/products-overview'

/** Overview of one group: the same page as every product, filtered to the group. */
export default async function GroupPage({ params }: { params: Promise<{ group: string }> }) {
  const { group: slug } = await params
  const { org, group, projects } = await requireGroup(slug)
  const t = await getTranslations()
  const edit = canManage(org.role) && (
    <Button asChild variant="outline">
      <Link href={`/g/${group.slug}/settings`}>{t('groups.edit')}</Link>
    </Button>
  )
  return (
    <ProductsOverview
      title={group.name}
      subtitle={t('overview.count', { count: projects.length })}
      action={edit || undefined}
      projects={projects}
      empty={
        <Card>
          <CardContent className="text-sm text-muted-foreground">{t('groups.empty')}</CardContent>
        </Card>
      }
    />
  )
}
