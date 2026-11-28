'use client'

import { ArrowRightIcon, CheckCircle2Icon, ClockIcon, LoaderCircleIcon } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useState } from 'react'
import { saveLogRetentionAction } from '@/actions/logs'
import { readableBytes } from '@/lib/logs'
import { LOG_TABS, type LogTab, logSnippet } from '@/lib/logs-setup'
import { ActionForm } from './action-form'
import { Option, OptionGroup } from './choice'
import { CopyField } from './copy-field'
import { FormNotice } from './form-notice'
import { SubmitButton } from './submit-button'
import { Button } from './ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

/** How often step 3 asks whether a line arrived. */
const POLL_MS = 3000
const RETENTION = [7, 14, 30, 90] as const

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {children}
      </div>
    </li>
  )
}

/**
 * The three steps of Set up Logs for one source: point the logs to Octadash
 * (code per language), how long to keep them (with the disk it takes), and a
 * live wait for the first line.
 */
export function LogsInstall({
  slug,
  sourceId,
  ingestUrl,
  publicKey,
  tab: initial,
  service,
  retention,
  bytesPerDay,
  canEdit,
  logsHref,
}: {
  slug: string
  sourceId: string
  ingestUrl: string
  publicKey: string
  tab: LogTab
  service: string
  retention: number
  /** About how much a day of this product's lines takes on disk, at today's rate. */
  bytesPerDay: number
  canEdit: boolean
  logsHref: string
}) {
  const t = useTranslations('logsSetup')
  const locale = useLocale()
  const [tab, setTab] = useState<LogTab>(initial)
  const [days, setDays] = useState(retention)
  const [last, setLast] = useState<{ at: string; service: string; body: string } | null>(null)

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = async () => {
      try {
        const response = await fetch(`/api/logs/last?source=${encodeURIComponent(sourceId)}`, {
          cache: 'no-store',
        })
        if (response.ok) {
          const data = (await response.json()) as typeof last
          if (!stop) setLast(data)
        }
      } catch {
        // Asks again on the next round.
      }
      if (!stop) timer = setTimeout(ask, POLL_MS)
    }
    void ask()
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }, [sourceId])

  const relative = (iso: string) => {
    const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    if (Math.abs(seconds) < 60) return rtf.format(seconds, 'second')
    if (Math.abs(seconds) < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
    return rtf.format(Math.round(seconds / 3600), 'hour')
  }
  const options = { ingestUrl, publicKey, service }

  return (
    <ol className="flex flex-col gap-6">
      <Step n={1} title={t('step1')}>
        <Tabs value={tab} onValueChange={(v) => setTab(v as LogTab)} className="gap-2">
          <TabsList
            aria-label={t('codeLabel')}
            className="max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto"
          >
            {LOG_TABS.map((p) => (
              <TabsTrigger key={p} value={p} className="h-8 flex-none px-2.5">
                {t(`tabs.${p}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {LOG_TABS.map((p) => {
            const s = logSnippet(p, options)
            return (
              <TabsContent key={p} value={p} className="flex flex-col gap-2">
                {s.install && (
                  <CopyField value={s.install} copyLabel={t('copy')} copiedLabel={t('copied')} />
                )}
                <p className="font-mono text-xs text-muted-foreground">{s.file}</p>
                <CopyField
                  value={s.code}
                  copyLabel={t('copy')}
                  copiedLabel={t('copied')}
                  multiline
                />
              </TabsContent>
            )
          })}
        </Tabs>
        <p className="text-xs text-muted-foreground">{t('serviceNote')}</p>
      </Step>

      <Step n={2} title={t('step2')}>
        <ActionForm action={saveLogRetentionAction}>
          <input type="hidden" name="slug" value={slug} />
          <OptionGroup legend={t('keepLegend')}>
            {RETENTION.map((d) => (
              <Option
                key={d}
                name="days"
                value={String(d)}
                checked={days === d}
                disabled={!canEdit}
                onChange={() => setDays(d)}
              >
                <ClockIcon aria-hidden className="size-4" />
                {t('days', { count: d })}
              </Option>
            ))}
          </OptionGroup>
          <p className="text-xs text-muted-foreground">
            {bytesPerDay > 0
              ? t('disk', { size: readableBytes(bytesPerDay * days, locale), days })
              : t('diskUnknown')}{' '}
            {days < retention && t('shorter', { days })}
          </p>
          {canEdit && days !== retention && (
            <SubmitButton className="self-start">{t('saveRetention')}</SubmitButton>
          )}
          <FormNotice />
        </ActionForm>
      </Step>

      <Step n={3} title={t('step3')}>
        <div
          aria-live="polite"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4 text-sm"
        >
          {last ? (
            <>
              <CheckCircle2Icon aria-hidden className="size-4 text-ok" />
              <span className="min-w-48 flex-1 break-words">
                {t('arrived', { service: last.service || '–', time: relative(last.at) })}
                <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                  {last.body}
                </span>
              </span>
              <Button asChild size="sm">
                <Link href={logsHref}>
                  {t('openLogs')}
                  <ArrowRightIcon data-icon="inline-end" aria-hidden />
                </Link>
              </Button>
            </>
          ) : (
            <>
              <LoaderCircleIcon aria-hidden className="size-4 animate-spin text-muted-foreground" />
              <span className="flex-1 text-muted-foreground">{t('waiting', { service })}</span>
            </>
          )}
        </div>
      </Step>
    </ol>
  )
}
