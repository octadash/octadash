import { generateHeartbeatToken, listRules, listSources } from '@octadash/db'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { durationLabel, GRACES, INTERVALS } from '@/lib/monitors'
import { services } from '@/server/context'
import { HourBar } from '@/views/overview-parts'
import { MonitorForm, type MonitorFormLabels, type MonitorFormValues } from './monitor-form'
import { Card, CardContent } from './ui/card'

const TIMEOUTS = [5, 10, 20, 30] as const

/**
 * The add and edit monitor page: the form on the left, and on the right an
 * example of what monitors look like and how checks work (or why heartbeats).
 */
export async function MonitorFormPage({
  orgId,
  project,
  values,
  timeZone,
  children,
}: {
  orgId: string
  project: { id: string; name: string; slug: string }
  values: Partial<MonitorFormValues>
  timeZone: string
  /** Under the heartbeat address: whether calls arrive. */
  children?: React.ReactNode
}) {
  const { db, env } = services()
  const [t, tu, common, rules, sources] = await Promise.all([
    getTranslations('monitorForm'),
    getTranslations('uptime'),
    getTranslations('common'),
    listRules(db, orgId, project.id),
    listSources(db, orgId, project.id),
  ])
  const editing = Boolean(values.id)
  const token = values.token ?? generateHeartbeatToken()
  const full: MonitorFormValues = {
    id: values.id,
    name: values.name ?? t('kinds.site.label'),
    kind: values.kind ?? 'site',
    url: values.url ?? '',
    interval: values.interval ?? 60,
    timeout: values.timeout ?? 10,
    grace: values.grace ?? 1800,
    schedule: values.schedule ?? null,
    token,
    sourceId: values.sourceId ?? null,
  }
  const duration = (seconds: number) => durationLabel(seconds, (key, v) => tu(key, v))
  const wait = (rules.find((r) => r.kind === 'monitor_down')?.params.minutes as number) ?? 2
  const kindLabel = (k: 'site' | 'health' | 'heartbeat' | 'tcp') => ({
    label: t(`kinds.${k}.label`),
    hint: t(`kinds.${k}.hint`),
  })
  const labels: MonitorFormLabels = {
    what: t('what'),
    kinds: {
      site: kindLabel('site'),
      health: kindLabel('health'),
      heartbeat: kindLabel('heartbeat'),
      tcp: kindLabel('tcp'),
    },
    later: t('later'),
    name: t('name'),
    nameHint: t('nameHint', { product: project.name, name: '{name}' }),
    url: t('url'),
    urlHint: { site: t('urlHint.site'), health: t('urlHint.health') },
    homeTitle: t('homeTitle'),
    homeMore: t('homeMore'),
    homeBody: t('homeBody'),
    source: t('source'),
    sourceHint: t('sourceHint'),
    sourceNone: t('sourceNone'),
    sourceInfo: { label: t('sourceInfoLabel'), body: t('sourceInfo') },
    snippetsTitle: t('snippetsTitle'),
    framework: t('framework'),
    runner: t('runner'),
    other: t('other'),
    every: t('every'),
    timeout: t('timeout'),
    checkNow: t('checkNow'),
    expected: t('expected'),
    expectedHint: t('expectedHint'),
    expectModes: {
      interval: t('expectModes.interval'),
      daily: t('expectModes.daily'),
      cron: t('expectModes.cron'),
    },
    at: t('at'),
    cron: t('cron'),
    cronHint: t('cronHint', { zone: timeZone }),
    grace: t('grace'),
    graceHint: t('graceHint'),
    graceInfo: { label: t('graceInfoLabel'), title: t('grace'), body: t('graceInfo') },
    callTitle: t('callTitle'),
    failHint: t('failHint'),
    submit: editing ? t('submitSave') : t('submitAdd'),
    cancel: common('cancel'),
    copy: common('copy'),
    copied: common('copied'),
  }
  const day = (missed: boolean) =>
    Array.from({ length: 30 }, (_, i) => (missed && i === 27 ? 'down' : 'up') as 'up' | 'down')

  const preview = (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('preview.title')}</h2>
          <span className="text-xs text-muted-foreground">{t('preview.example')}</span>
        </div>
        <ul className="flex flex-col gap-2.5 text-sm">
          {(
            [
              ['site', 'siteLine', false],
              ['api', 'apiLine', false],
              ['backup', 'backupLine', true],
            ] as const
          ).map(([name, line, missed]) => (
            <li key={name} className="flex flex-col gap-1">
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-medium">
                  <span aria-hidden className={missed ? 'text-error' : 'text-ok'}>
                    {missed ? '▲' : '●'}
                  </span>
                  <span className="sr-only">{missed ? t('preview.missed') : t('preview.up')}:</span>
                  {t(`preview.${name}`)}
                </span>
                <span className="text-xs text-muted-foreground">{t(`preview.${line}`)}</span>
              </span>
              <HourBar hours={day(missed)} className="w-full" />
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t('preview.note')}</p>
      </CardContent>
    </Card>
  )
  const how = (
    <Card>
      <CardContent className="flex flex-col gap-2 text-sm">
        <h2 className="font-semibold">{t('how.title')}</h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-muted-foreground">
          <li>{t('how.every')}</li>
          <li>
            {t('how.three', { minutes: wait })}{' '}
            <Link
              href={`/p/${project.slug}/settings/rules`}
              className="text-brand underline underline-offset-2"
            >
              {t('how.rules')}
            </Link>
          </li>
          <li>{t('how.extras')}</li>
          <li>{t('how.database')}</li>
        </ul>
      </CardContent>
    </Card>
  )
  const why = (
    <Card>
      <CardContent className="flex flex-col gap-2 text-sm">
        <h2 className="font-semibold">{t('why.title')}</h2>
        <p className="text-muted-foreground">{t('why.body')}</p>
        <p className="text-muted-foreground">{t('why.good')}</p>
      </CardContent>
    </Card>
  )

  return (
    <MonitorForm
      slug={project.slug}
      values={full}
      intervals={INTERVALS.map((value) => ({ value, label: duration(value) }))}
      timeouts={TIMEOUTS.map((value) => ({ value, label: t('timeoutValue', { count: value }) }))}
      graces={GRACES.map((value) => ({
        value,
        label: value === 0 ? tu('none') : duration(value),
      }))}
      heartbeatUrl={`${env.OCTADASH_INGEST_URL.replace(/\/$/, '')}/o/v1/hb/${token}`}
      cancelHref={`/p/${project.slug}/uptime`}
      labels={labels}
      sources={sources.map((s) => ({ id: s.id, name: s.name }))}
      aside={{ preview, how, why }}
    >
      {children}
    </MonitorForm>
  )
}
