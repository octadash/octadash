import { getProjectBySlug, listMonitors, listSources, sourceActivity } from '@octadash/db'
import { ActivityIcon, ArrowRightIcon, ChevronRightIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { InfoTip } from '@/components/info-tip'
import { AddSourceDialog } from '@/components/source-forms'
import { SourceStatus } from '@/components/source-status'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AREA_ITEMS } from '@/lib/areas'
import { isSourcePlatform } from '@/lib/sources'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

/** Product settings › Sources: each part of the product that sends data, with its key. */
export default async function ProductSourcesPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const { org } = await requireOrg()
  const { db, clickhouse } = services()
  const project = await getProjectBySlug(db, org.id, slug)
  if (!project) notFound()
  const [sources, monitors, activity, t, ta, tp] = await Promise.all([
    listSources(db, org.id, project.id),
    listMonitors(db, org.id, project.id),
    sourceActivity(clickhouse, org.id, project.id).catch(() => null),
    getTranslations('productSettings.sourcesPage'),
    getTranslations('areas'),
    getTranslations('platforms'),
  ])
  const [format, locale] = await Promise.all([getFormatter(), getLocale()])
  const base = `/p/${project.slug}/settings/sources`
  const order = (area: string) => AREA_ITEMS.findIndex((a) => a.id === area)

  return (
    <>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="flex items-center gap-1 font-display text-3xl font-semibold">
            {t('title')}
            <InfoTip label={t('infoLabel')} title={t('infoLabel')}>
              {t('info')}
            </InfoTip>
          </h1>
          <p className="text-sm text-muted-foreground">{t('intro', { name: project.name })}</p>
        </div>
        {canManage(org.role) && <AddSourceDialog slug={project.slug} />}
      </div>

      {sources.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{t('columns.source')}</TableHead>
                <TableHead>{t('columns.areas')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('columns.key')}</TableHead>
                <TableHead>{t('columns.last')}</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">{t('open', { name: '' })}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((s) => {
                const seen = activity?.get(s.id)
                const areas = [...s.areas].filter((a) => order(a) >= 0)
                areas.sort((a, b) => order(a) - order(b))
                return (
                  <TableRow key={s.id} className="relative">
                    <TableCell className="pl-4">
                      <div className="flex flex-col">
                        <Link
                          href={`${base}/${s.id}`}
                          className="font-medium after:absolute after:inset-0 hover:underline"
                        >
                          {s.name}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {isSourcePlatform(s.platform) ? tp(s.platform) : s.platform}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {areas.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {areas.map((a) => (
                            <Badge key={a} variant="secondary">
                              {ta(`${a}.name`)}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t('nothingYet')}</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                      {s.public_key ? `${s.public_key.slice(0, 8)}…` : ''}
                    </TableCell>
                    <TableCell>
                      <SourceStatus
                        last={seen?.last ?? null}
                        unknown={activity === null}
                        locale={locale}
                        relative={(date) => format.relativeTime(date)}
                        labels={{
                          receiving: (time) => t('receiving', { time }),
                          quiet: (time) => t('quiet', { time }),
                          never: t('never'),
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {monitors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-sm font-semibold">{t('also', { name: project.name })}</h2>
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t('alsoBody')}</p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
              <Badge variant="outline">
                <ActivityIcon aria-hidden />
                {ta('uptime.name')}
              </Badge>
              <span className="flex-1">{t('monitors', { count: monitors.length })}</span>
              <Link
                href={`/p/${project.slug}/uptime`}
                className="inline-flex items-center gap-1 text-brand hover:underline"
              >
                {t('monitorsLink')}
                <ArrowRightIcon aria-hidden className="size-3.5" />
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
