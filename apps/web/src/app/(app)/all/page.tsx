import { listProjects } from '@octadash/db'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'

/**
 * Overview of every product. The blocks by area (uptime, traffic, errors...)
 * arrive with each area's data; until then this lists the products.
 */
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
    <>
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold">{t('areas.overview.name')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('overview.count', { count: projects.length })}
        </p>
      </div>
      <Card className="py-0">
        <Table>
          <TableBody>
            {projects.map((project) => (
              <TableRow key={project.id}>
                <TableCell className="px-4">
                  <Link href={`/p/${project.slug}`} className="font-medium hover:text-brand">
                    {project.name}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  )
}
