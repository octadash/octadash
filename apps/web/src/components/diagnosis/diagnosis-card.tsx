import { getDiagnosisState } from '@octadash/db'
import { LEVELS } from '@octadash/diagnosis'
import { LoaderCircleIcon, RefreshCwIcon } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'
import { runDiagnosisAction } from '@/actions/diagnosis'
import { AutoRefresh } from '@/components/auto-refresh'
import { CopyField } from '@/components/copy-field'
import { SubmitButton } from '@/components/submit-button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { services } from '@/server/context'
import { findingText } from './finding-text'
import { StatusIcon } from './status-icon'

/** The product's observability levels, as seen from outside, with what to do next. */
export async function DiagnosisCard({
  orgId,
  project,
}: {
  orgId: string
  project: { id: string; url: string | null }
}) {
  const [state, t, tf, common, format] = await Promise.all([
    getDiagnosisState(services().db, orgId, project.id),
    getTranslations('diagnosis'),
    getTranslations('diagnosis.findings'),
    getTranslations('common'),
    getFormatter(),
  ])
  const report = state.last?.status === 'done' ? state.last.report : null
  const failed = state.last?.status === 'failed' ? state.last : null
  const healthMissing = report?.levels
    .find((level) => level.id === 'alive')
    ?.findings.some((f) => f.id === 'health' && f.status === 'missing')
  const ads = report?.tools.filter((tool) => tool.categories.includes('ads')) ?? []

  return (
    <Card>
      {state.pending && <AutoRefresh />}
      <CardHeader>
        <CardTitle>
          <h2 className="font-display text-lg font-semibold">{t('title')}</h2>
        </CardTitle>
        <CardDescription>{t('intro')}</CardDescription>
        {project.url && (
          <CardAction>
            <form action={runDiagnosisAction}>
              <input type="hidden" name="projectId" value={project.id} />
              <SubmitButton variant="outline" disabled={Boolean(state.pending)}>
                {state.pending ? (
                  <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
                ) : (
                  <RefreshCwIcon data-icon="inline-start" />
                )}
                {t('runAgain')}
              </SubmitButton>
            </form>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {!project.url && <p className="text-sm text-muted-foreground">{t('noUrl')}</p>}
        {project.url && state.pending && (
          <p role="status" className="flex items-center gap-2 text-sm text-brand">
            <LoaderCircleIcon className="size-4 animate-spin" />
            {t('running')}
          </p>
        )}
        {project.url && !state.pending && !state.last && (
          <p className="text-sm text-muted-foreground">{t('neverRan')}</p>
        )}
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {t('failed', { error: failed.error ?? '?' })}
          </p>
        )}

        {report && state.last?.finished_at && (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <Badge variant="brand">
                {t('score', { score: report.score, total: LEVELS.length })}
              </Badge>
              <span className="text-muted-foreground">
                {t('checked', { time: format.relativeTime(state.last.finished_at) })}
              </span>
            </div>

            <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {report.levels.map((level, index) => (
                <li key={level.id} className="flex gap-3 px-4 py-3">
                  <span className="w-4 pt-0.5 text-xs font-medium text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h3 className="font-medium">{t(`levels.${level.id}.name`)}</h3>
                      <span className="text-sm text-muted-foreground">
                        {t(`levels.${level.id}.question`)}
                      </span>
                    </div>
                    <ul className="flex flex-col gap-1">
                      {level.findings.map((finding) => (
                        <li key={finding.id} className="flex items-start gap-2 text-sm">
                          <StatusIcon
                            status={finding.status}
                            label={t(`status.${finding.status}`)}
                            className="mt-0.5 size-3.5"
                          />
                          <span>{findingText(tf, finding)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <span className="flex shrink-0 items-start gap-1.5 pt-0.5 text-xs text-muted-foreground">
                    <StatusIcon status={level.status} />
                    <span className="hidden sm:inline">{t(`status.${level.status}`)}</span>
                  </span>
                </li>
              ))}
            </ol>

            {healthMissing && (
              <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-4">
                <h3 className="text-sm font-medium">{t('healthPrompt.title')}</h3>
                <p className="text-sm text-muted-foreground">{t('healthPrompt.body')}</p>
                <CopyField
                  multiline
                  value={t('healthPrompt.text')}
                  copyLabel={common('copy')}
                  copiedLabel={common('copied')}
                />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{t('toolsTitle')}</h3>
              {report.tools.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noTools')}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {report.tools.map((tool) => (
                    <Badge key={tool.id} variant={ads.includes(tool) ? 'outline' : 'secondary'}>
                      {tool.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
