import Link from 'next/link'
import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'

/**
 * The overview of several products: every product, or one group. The blocks
 * by area (uptime, traffic, errors...) arrive with each area's data; until
 * then this lists the products.
 */
export function ProductsOverview({
  title,
  subtitle,
  action,
  projects,
  empty,
}: {
  title: string
  subtitle: string
  action?: ReactNode
  projects: { id: string; slug: string; name: string }[]
  empty?: ReactNode
}) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {action}
      </div>
      {projects.length === 0 && empty}
      {projects.length > 0 && (
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
      )}
    </>
  )
}
