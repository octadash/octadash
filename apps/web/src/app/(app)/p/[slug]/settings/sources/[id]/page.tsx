import {
  getProjectBySlug,
  getSource,
  listSourceKeys,
  sentryDsn,
  sourceActivity,
} from '@octadash/db'
import { CodeIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { stopOldKeyAction } from '@/actions/sources'
import { CopyField } from '@/components/copy-field'
import { InfoTip } from '@/components/info-tip'
import { DeleteSourceDialog, RotateKeyDialog, SourceDetailsForm } from '@/components/source-forms'
import { SourceStatus } from '@/components/source-status'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { VisitorModeSwitch } from '@/components/visitor-mode-switch'
import { AREA_ITEMS } from '@/lib/areas'
import { isSourcePlatform } from '@/lib/sources'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

/** The areas whose data a source can send today, and how its 24-hour count reads. */
const SENDS = ['traffic', 'usage', 'errors', 'logs'] as const

/** One source: what it sent, its key (with rotation), name and platform, options, delete. */
export default async function SourcePage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  const { org } = await requireOrg()
  const { db, clickhouse, env } = services()
  const [project, source] = await Promise.all([
    getProjectBySlug(db, org.id, slug),
    getSource(db, org.id, id),
  ])
  if (!project || !source || source.project_id !== project.id) notFound()
  const manager = canManage(org.role)
  const [keys, activity, t, ta, tp, tc, format, locale] = await Promise.all([
    listSourceKeys(db, org.id, source.id),
    sourceActivity(clickhouse, org.id, project.id).catch(() => null),
    getTranslations('productSettings'),
    getTranslations('areas'),
    getTranslations('platforms'),
    getTranslations('common'),
    getFormatter(),
    getLocale(),
  ])
  const seen = activity?.get(source.id)
  const base = `/p/${project.slug}/settings/sources`
  const platform = isSourcePlatform(source.platform) ? tp(source.platform) : source.platform
  const current = keys.find((k) => k.revoked_at === null)
  const old = keys.filter((k) => k.revoked_at !== null)
  const ingest = env.OCTADASH_INGEST_URL.replace(/\/$/, '')
  const traffic = source.areas.includes('traffic')
  const count = (area: (typeof SENDS)[number]) =>
    area === 'traffic' ? seen?.pageviews : area === 'usage' ? seen?.events : undefined
  const icon = (area: string) => AREA_ITEMS.find((a) => a.id === area)?.icon

  return (
    <>
      <nav aria-label={t('source.back')} className="text-sm">
        <Link href={base} className="text-brand hover:underline">
          {t('source.back')}
        </Link>
        <span aria-hidden className="text-muted-foreground">
          {' '}
          / {source.name}
        </span>
      </nav>
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-semibold">{source.name}</h1>
            <SourceStatus
              last={seen?.last ?? null}
              unknown={activity === null}
              locale={locale}
              relative={(date) => format.relativeTime(date)}
              labels={{
                receiving: (time) => t('sourcesPage.receiving', { time }),
                quiet: (time) => t('sourcesPage.quiet', { time }),
                never: t('sourcesPage.never'),
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {t('source.created', {
              platform,
              date: format.dateTime(source.created_at, { dateStyle: 'medium' }),
            })}
          </p>
        </div>
        {traffic && (
          <Button asChild variant="outline">
            <Link href={`/p/${project.slug}/traffic/setup?source=${source.id}`}>
              <CodeIcon data-icon="inline-start" aria-hidden />
              {t('source.installCode')}
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>
            <h2 className="text-sm font-semibold">{t('source.sends')}</h2>
          </CardTitle>
          <span className="text-xs text-muted-foreground">{t('source.last24')}</span>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {SENDS.map((area) => {
              const Icon = icon(area)
              const value = count(area)
              const built = area === 'traffic' || area === 'usage'
              return (
                <div
                  key={area}
                  className="flex flex-col gap-1 rounded-lg border border-border p-3 data-[off=true]:border-dashed"
                  data-off={!built}
                >
                  <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {Icon && <Icon aria-hidden className="size-3.5" />}
                    {ta(`${area}.name`)}
                  </dt>
                  <dd className="flex flex-col">
                    <span className="font-display text-xl font-semibold tabular-nums">
                      {built && value ? format.number(value) : '—'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {!built
                        ? t('source.soon')
                        : value
                          ? area === 'traffic'
                            ? t('source.pageviews')
                            : t('source.events')
                          : t('source.nothingSent')}
                    </span>
                  </dd>
                </div>
              )
            })}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <CardTitle>
              <h2 className="text-sm font-semibold">{t('source.keyTitle')}</h2>
            </CardTitle>
            <p className="text-sm text-muted-foreground">{t('source.keyBody')}</p>
          </div>
          {manager && (
            <RotateKeyDialog slug={project.slug} sourceId={source.id} name={source.name} />
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {current && (
            <>
              <KeyField label={t('source.key')} value={current.public_key} tc={tc} />
              <KeyField
                label={t('source.dsn')}
                info={
                  <InfoTip label={t('source.dsnInfoLabel')} title={t('source.dsn')}>
                    {t('source.dsnInfo')}
                  </InfoTip>
                }
                value={sentryDsn(ingest, current.public_key, String(project.ingest_id))}
                tc={tc}
              />
            </>
          )}
          <KeyField label={t('source.ingest')} value={ingest} tc={tc} />
          {old.map((k) => (
            <div
              key={k.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/10 p-3"
            >
              <div className="flex min-w-48 flex-1 flex-col gap-0.5">
                <span className="text-xs font-medium">{t('source.oldKey')}</span>
                <span className="font-mono text-xs break-all">{k.public_key}</span>
                <span className="text-xs text-muted-foreground">
                  {t('source.stopsIn', {
                    time: format.relativeTime(k.revoked_at ?? new Date()),
                  })}
                </span>
              </div>
              {manager && (
                <form action={stopOldKeyAction}>
                  <input type="hidden" name="slug" value={project.slug} />
                  <input type="hidden" name="source" value={source.id} />
                  <input type="hidden" name="key" value={k.id} />
                  <Button type="submit" size="sm" variant="outline">
                    {t('source.stopNow')}
                  </Button>
                </form>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-sm font-semibold">{t('source.detailsTitle')}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SourceDetailsForm
            slug={project.slug}
            sourceId={source.id}
            name={source.name}
            platform={source.platform}
            product={project.name}
            disabled={!manager}
          />
        </CardContent>
      </Card>

      {traffic && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-sm font-semibold">{t('source.trafficTitle')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <VisitorModeSwitch
              slug={project.slug}
              sourceId={source.id}
              persistent={source.visitor_mode === 'persistent'}
              disabled={!manager}
            />
            <p className="text-xs text-muted-foreground">{t('source.localNote')}</p>
          </CardContent>
        </Card>
      )}

      {manager && (
        <Card className="ring-destructive/40">
          <CardContent className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <h2 className="text-sm font-semibold text-destructive">{t('source.deleteTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('source.deleteBody')}</p>
            </div>
            <DeleteSourceDialog slug={project.slug} sourceId={source.id} name={source.name} />
          </CardContent>
        </Card>
      )}
    </>
  )
}

function KeyField({
  label,
  value,
  info,
  tc,
}: {
  label: string
  value: string
  info?: React.ReactNode
  tc: (key: 'copy' | 'copied') => string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {info}
      </span>
      <CopyField value={value} label={label} copyLabel={tc('copy')} copiedLabel={tc('copied')} />
    </div>
  )
}
