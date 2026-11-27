import { latestReportsForOrg, listProjects, pendingProjectsForOrg } from '@octadash/db'
import { LEVELS, type LevelId } from '@octadash/diagnosis'
import { LoaderCircleIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AutoRefresh } from '@/components/auto-refresh'
import { StatusIcon } from '@/components/diagnosis/status-icon'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'

/** Levels a missing answer can be fixed for from outside; the others need connectors. */
const GAP_LEVELS = ['alive', 'used', 'breaking', 'growing'] as const satisfies LevelId[]

export default async function AllPage() {
  const { org } = await requireOrg()
  const { db } = services()
  const [projects, reports, pending, t, td] = await Promise.all([
    listProjects(db, org.id),
    latestReportsForOrg(db, org.id),
    pendingProjectsForOrg(db, org.id),
    getTranslations('projects'),
    getTranslations('diagnosis'),
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

  const diagnosed = projects.filter((p) => reports.has(p.id))
  const gaps = GAP_LEVELS.map((level) => ({
    level,
    count: diagnosed.filter(
      (p) => reports.get(p.id)?.report?.levels.find((l) => l.id === level)?.status === 'missing',
    ).length,
  })).filter((gap) => gap.count > 0)

  return (
    <>
      {pending.size > 0 && <AutoRefresh />}
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">{td('all.title')}</h1>
        <p className="text-sm text-muted-foreground">
          {td('all.diagnosed', { count: diagnosed.length, total: projects.length })}
        </p>
      </div>

      {diagnosed.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {gaps.length === 0 ? (
            <Badge variant="ok">{td('all.allGood')}</Badge>
          ) : (
            gaps.map((gap) => (
              <Badge key={gap.level} variant={gap.level === 'alive' ? 'error' : 'warn'}>
                {td(`all.gaps.${gap.level}`, { count: gap.count })}
              </Badge>
            ))
          )}
        </div>
      )}

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">{td('all.product')}</TableHead>
              {LEVELS.map((level) => (
                <TableHead key={level} className="text-center">
                  {td(`levels.${level}.name`)}
                </TableHead>
              ))}
              <TableHead className="pr-4 text-right">{td('all.score')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project) => {
              const report = reports.get(project.id)?.report
              const isPending = pending.has(project.id)
              return (
                <TableRow key={project.id}>
                  <TableCell className="pl-4">
                    <Link href={`/p/${project.slug}`} className="flex flex-col hover:text-brand">
                      <span className="font-medium">{project.name}</span>
                      {project.url && (
                        <span className="max-w-56 truncate text-xs text-muted-foreground">
                          {project.url.replace(/^https?:\/\//, '')}
                        </span>
                      )}
                    </Link>
                  </TableCell>
                  {report ? (
                    <>
                      {LEVELS.map((level) => {
                        const status =
                          report.levels.find((l) => l.id === level)?.status ?? 'unknown'
                        return (
                          <TableCell key={level} className="text-center">
                            <StatusIcon
                              status={status}
                              label={`${td(`levels.${level}.name`)}: ${td(`status.${status}`)}`}
                              className="mx-auto"
                            />
                          </TableCell>
                        )
                      })}
                      <TableCell className="pr-4 text-right tabular-nums">
                        {isPending && (
                          <LoaderCircleIcon className="mr-1.5 inline size-3.5 animate-spin text-brand" />
                        )}
                        {report.score}/{LEVELS.length}
                      </TableCell>
                    </>
                  ) : (
                    <TableCell
                      colSpan={LEVELS.length + 1}
                      className="pr-4 text-right text-sm text-muted-foreground"
                    >
                      {isPending ? (
                        <span className="inline-flex items-center gap-1.5 text-brand">
                          <LoaderCircleIcon className="size-3.5 animate-spin" />
                          {td('all.pending')}
                        </span>
                      ) : project.url ? (
                        td('all.noReport')
                      ) : (
                        td('all.noUrl')
                      )}
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>
    </>
  )
}
