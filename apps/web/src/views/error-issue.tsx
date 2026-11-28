import { InfoIcon } from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { CopyButton } from '@/components/copy-button'
import { IgnoreDialog, IssueButton } from '@/components/issue-actions'
import { StackTrace } from '@/components/stack-trace'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { issueTitle, personLabel } from '@/lib/errors'
import { flagOf } from '@/lib/traffic'
import type { IssueData } from '@/server/errors'
import { ignoreLabels } from './error-labels'
import { IssueIcon } from './errors'

/**
 * One issue, as closed in the Errors canvas: who is on it and the actions,
 * the numbers of the last 30 days, the release it started in, where it
 * happened, what the person did before, who it hits and the event shown.
 */
export async function ErrorIssueView({
  data,
  userId,
  origin,
}: {
  data: IssueData
  userId: string
  /** The panel's address, for "Copy link". */
  origin: string
}) {
  const [t, tc, format, locale] = await Promise.all([
    getTranslations('errorsArea'),
    getTranslations('common'),
    getFormatter(),
    getLocale(),
  ])
  const { issue, product, event } = data
  const now = new Date()
  const ago = (date: Date | number) => format.relativeTime(date, now)
  const number = new Intl.NumberFormat(locale)
  const percent = new Intl.NumberFormat(locale, { style: 'percent' })
  const title = issueTitle(issue)
  const base = `/p/${product.slug}/errors`
  const link = `${origin}${base}/${issue.id}`
  const taken = issue.acknowledged_at !== null && issue.acknowledged_by_name !== null
  const ignore = await ignoreLabels()
  const kindLabels = {
    unhandled: t('kind.unhandled'),
    handled: t('kind.handled'),
    warning: t('kind.warning'),
  }
  const max = Math.max(1, ...data.series.map((p) => p.events))
  const region = new Intl.DisplayNames([locale], { type: 'region' })
  const facetValue = (facet: string, value: string) =>
    !value
      ? t('issue.unknown')
      : facet === 'country'
        ? `${flagOf(value)} ${region.of(value) ?? value}`
        : value
  const person = event ? personLabel(event.person) : null

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('issue.breadcrumb')} className="text-sm">
        <Link href={base} className="text-brand underline underline-offset-4">
          {t('title')}
        </Link>
        <span aria-hidden className="text-muted-foreground">
          {' '}
          / {product.name}
        </span>
      </nav>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <IssueIcon issue={issue} labels={kindLabels} />
          <h1 className="font-display text-2xl font-semibold break-words">{title}</h1>
          {issue.status === 'unresolved' &&
            now.getTime() - issue.first_seen.getTime() < 86_400_000 && (
              <Badge variant="brand">{t('badges.new')}</Badge>
            )}
          {issue.regressed_at && issue.status === 'unresolved' && (
            <Badge variant="warn">{t('badges.regressed')}</Badge>
          )}
          {issue.status !== 'unresolved' && (
            <Badge variant="secondary">{t(`status.${issue.status}`)}</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {issue.culprit && <span className="font-mono">{issue.culprit}</span>}
          {[
            issue.handled ? t('kind.handled') : t('kind.unhandled'),
            issue.platform,
            product.name,
            data.source?.name,
          ]
            .filter(Boolean)
            .map((part) => ` · ${part}`)
            .join('')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {taken ? (
          <span className="flex items-center gap-2 rounded-lg border border-ok/40 bg-ok/10 px-3 py-1.5 text-sm">
            <span aria-hidden className="size-2 rounded-full bg-ok" />
            {t('issue.onIt', {
              name: issue.acknowledged_by_name ?? '',
              ago: ago(issue.acknowledged_at ?? now),
            })}
          </span>
        ) : (
          <IssueButton issueId={issue.id} kind="take" label={t('actions.take')} variant="outline" />
        )}
        {issue.status === 'unresolved' ? (
          <>
            <IssueButton issueId={issue.id} kind="resolve" label={t('actions.resolve')} />
            <IssueButton
              issueId={issue.id}
              kind="resolveInNextRelease"
              label={t('actions.nextRelease')}
              variant="outline"
            />
            <IgnoreDialog issueId={issue.id} labels={ignore} />
          </>
        ) : (
          <IssueButton
            issueId={issue.id}
            kind="reopen"
            label={t('actions.reopen')}
            variant="outline"
          />
        )}
        {issue.acknowledged_by === userId && (
          <IssueButton issueId={issue.id} kind="leave" label={t('actions.leave')} variant="ghost" />
        )}
        <span className="ml-auto">
          <CopyButton value={link} label={t('actions.copyLink')} copiedLabel={tc('copied')} />
        </span>
      </div>
      {issue.status !== 'unresolved' && (
        <p className="text-sm text-muted-foreground">
          {issue.status === 'resolved'
            ? issue.resolved_release
              ? t('issue.resolvedIn', { release: issue.resolved_release })
              : t('issue.resolved')
            : t('issue.ignored')}
        </p>
      )}

      {!data.complete && (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
          {t('incomplete')}
        </p>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground uppercase">{t('issue.events')}</dt>
              <dd className="font-display text-xl font-semibold tabular-nums">
                {number.format(data.stats.events)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase">{t('issue.people')}</dt>
              <dd className="font-display text-xl font-semibold tabular-nums">
                {data.stats.people > 0 ? number.format(data.stats.people) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase">{t('issue.firstSeen')}</dt>
              <dd className="text-sm">
                {[issue.first_release, ago(issue.first_seen)].filter(Boolean).join(' · ')}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground uppercase">{t('issue.lastSeen')}</dt>
              <dd className="text-sm">
                {[issue.last_release, ago(issue.last_seen)].filter(Boolean).join(' · ')}
              </dd>
            </div>
          </dl>
          <figure className="flex flex-col gap-1">
            <figcaption className="text-xs text-muted-foreground">{t('issue.chart')}</figcaption>
            <svg
              role="img"
              aria-label={t('issue.chartLabel', { events: data.stats.events })}
              viewBox={`0 0 ${data.series.length * 10} 40`}
              preserveAspectRatio="none"
              className="h-12 w-full"
            >
              {data.series.map((p, i) => {
                const h = p.events === 0 ? 1 : Math.max(3, (p.events / max) * 40)
                return (
                  <rect
                    key={p.at.toISOString()}
                    x={i * 10 + 1}
                    y={40 - h}
                    width={8}
                    height={h}
                    className={p.events === 0 ? 'fill-muted' : 'fill-brand'}
                  />
                )
              })}
            </svg>
            <details className="text-xs">
              <summary className="cursor-pointer text-brand">{t('chart.asTable')}</summary>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('chart.time')}</TableHead>
                    <TableHead className="text-right">{t('issue.events')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.series
                    .filter((p) => p.events > 0)
                    .map((p) => (
                      <TableRow key={p.at.toISOString()}>
                        <TableCell>
                          {format.dateTime(p.at, { dateStyle: 'medium', timeZone: data.timeZone })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {number.format(p.events)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </details>
          </figure>
        </CardContent>
      </Card>

      {issue.first_release && (
        <div className="flex gap-3 rounded-lg border border-border bg-card p-4 text-sm">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">
              {t('issue.startedIn', { release: issue.first_release, ago: ago(issue.first_seen) })}
            </p>
            <p className="text-muted-foreground">{t('issue.nextReleaseHint')}</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardContent>
              {event ? (
                <StackTrace
                  exceptions={
                    event.exception.length > 0
                      ? event.exception
                      : [{ type: issue.type, value: issue.value, frames: [] }]
                  }
                  labels={{
                    title: t('issue.where'),
                    ownOnly: t('issue.ownOnly'),
                    at: t.raw('issue.at') as string,
                    atLine: t.raw('issue.atLine') as string,
                    hidden: t.raw('issue.hidden') as string,
                    showAll: t('issue.showAll'),
                    causedBy: t('issue.causedBy'),
                    noFrames: t('issue.noFrames'),
                  }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{t('issue.noEvent')}</p>
              )}
            </CardContent>
          </Card>

          {event && (
            <Card>
              <CardContent className="flex flex-col gap-3">
                <h2 className="text-base font-semibold">{t('issue.before')}</h2>
                {event.breadcrumbs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('issue.noBreadcrumbs')}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('issue.time')}</TableHead>
                        <TableHead>{t('issue.kind')}</TableHead>
                        <TableHead>{t('issue.what')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {event.breadcrumbs.map((crumb, i) => (
                        <TableRow
                          // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumbs in order.
                          key={i}
                        >
                          <TableCell className="font-mono text-xs tabular-nums">
                            {crumb.timestamp
                              ? format.dateTime(crumb.timestamp, {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                  timeZone: data.timeZone,
                                })
                              : '—'}
                          </TableCell>
                          <TableCell className="text-sm">{crumb.category || crumb.type}</TableCell>
                          <TableCell className="max-w-0 truncate font-mono text-xs">
                            {crumb.message || (crumb.data ? JSON.stringify(crumb.data) : '')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-4">
              <h2 className="text-base font-semibold">{t('issue.whoTitle')}</h2>
              {(['browser', 'release', 'path', 'country'] as const).map((facet) => (
                <section key={facet} className="flex flex-col gap-1.5">
                  <h3 className="text-xs text-muted-foreground">{t(`issue.facets.${facet}`)}</h3>
                  {(data.facets[facet] ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">—</p>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {data.facets[facet].map((share) => (
                        <li key={share.value} className="flex items-center gap-2 text-sm">
                          <span className="relative flex h-6 min-w-0 flex-1 items-center overflow-hidden rounded bg-muted px-2">
                            <span
                              aria-hidden
                              className="absolute inset-y-0 left-0 bg-brand/25"
                              style={{ width: `${Math.round(share.share * 100)}%` }}
                            />
                            <span className="relative truncate">
                              {facetValue(facet, share.value)}
                            </span>
                          </span>
                          <span className="w-10 text-right tabular-nums">
                            {percent.format(share.share)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </CardContent>
          </Card>

          {event && (
            <Card>
              <CardContent className="flex flex-col gap-3">
                <h2 className="text-base font-semibold">{t('issue.thisEvent')}</h2>
                <dl className="flex flex-col gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground uppercase">{t('issue.person')}</dt>
                    <dd>
                      {!person?.label
                        ? t('issue.nobody')
                        : person.anonymous
                          ? t('issue.anonymous', { id: person.label })
                          : person.label}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground uppercase">
                      {t('issue.environment')}
                    </dt>
                    <dd>{event.environment || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground uppercase">
                      {t('issue.release')}
                    </dt>
                    <dd>{event.release || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground uppercase">{t('issue.source')}</dt>
                    <dd>{data.source?.name ?? '—'}</dd>
                  </div>
                  {event.url && (
                    <div>
                      <dt className="text-xs text-muted-foreground uppercase">{t('issue.page')}</dt>
                      <dd className="break-all">{event.url}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-muted-foreground uppercase">
                      {t('issue.received')}
                    </dt>
                    <dd>
                      {format.dateTime(new Date(event.timestamp), {
                        dateStyle: 'medium',
                        timeStyle: 'medium',
                        timeZone: data.timeZone,
                      })}
                      {` · ${ago(new Date(event.timestamp))}`}
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-3 text-sm">
                  {event.previous && (
                    <Link
                      href={`${base}/${issue.id}?event=${event.previous}`}
                      className="text-brand underline underline-offset-4"
                    >
                      {t('issue.previous')}
                    </Link>
                  )}
                  <Link
                    href={`${base}/${issue.id}`}
                    className="text-brand underline underline-offset-4"
                  >
                    {t('issue.newest')}
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
