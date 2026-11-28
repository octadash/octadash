import { listProjects } from '@octadash/db'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'

/**
 * "All products". The overview by area (uptime, traffic, errors...) arrives
 * with the panel layout and the areas themselves; until then this lists the
 * products so each one can be opened.
 */
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
    <>
      <h1 className="font-display text-2xl font-semibold">{t('allTitle')}</h1>
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
