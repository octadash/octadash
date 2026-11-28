'use client'

import { ArrowRightIcon, CheckCircle2Icon, LoaderCircleIcon } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useState } from 'react'
import { USAGE_TABS, type UsageTab, usageSnippet } from '@/lib/usage-setup'
import { CopyField } from './copy-field'
import { Button } from './ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

/** How often step 4 asks whether an event arrived. */
const POLL_MS = 3000

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
 * The four steps of Set up Product usage for one source: send an event (code
 * per platform), tie events to a person, mark the key events (`keyEvents`,
 * rendered by the page) and a live wait for the first event.
 */
export function UsageInstall({
  sourceId,
  ingestUrl,
  publicKey,
  hasScript,
  tab: initial,
  keyEvents,
  usageHref,
}: {
  sourceId: string
  ingestUrl: string
  publicKey: string
  hasScript: boolean
  tab: UsageTab
  keyEvents: ReactNode
  usageHref: string
}) {
  const t = useTranslations('usageSetup')
  const locale = useLocale()
  const [tab, setTab] = useState<UsageTab>(initial)
  const [last, setLast] = useState<{ at: string; event: string } | null>(null)

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = async () => {
      try {
        const response = await fetch(`/api/usage/last?source=${encodeURIComponent(sourceId)}`, {
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

  const options = { ingestUrl, publicKey, hasScript }
  const relative = (iso: string) => {
    const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    if (Math.abs(seconds) < 60) return rtf.format(seconds, 'second')
    if (Math.abs(seconds) < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
    return rtf.format(Math.round(seconds / 3600), 'hour')
  }
  const snippet = usageSnippet(tab, options)

  return (
    <ol className="flex flex-col gap-6">
      <Step n={1} title={t('step1')}>
        <Tabs value={tab} onValueChange={(v) => setTab(v as UsageTab)} className="gap-2">
          <TabsList
            aria-label={t('codeLabel')}
            className="max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto"
          >
            {USAGE_TABS.map((p) => (
              <TabsTrigger key={p} value={p} className="h-8 flex-none px-2.5">
                {t(`tabs.${p}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          {USAGE_TABS.map((p) => {
            const s = usageSnippet(p, options)
            return (
              <TabsContent key={p} value={p} className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">{t(`where.${s.where}`)}</p>
                <CopyField
                  value={s.track}
                  copyLabel={t('copy')}
                  copiedLabel={t('copied')}
                  multiline
                />
                <p className="text-xs text-muted-foreground">
                  {p === 'posthog' ? t('notePosthog') : t('noteNames')}
                </p>
              </TabsContent>
            )
          })}
        </Tabs>
      </Step>

      <Step n={2} title={t('step2')}>
        <CopyField
          value={snippet.identify}
          copyLabel={t('copy')}
          copiedLabel={t('copied')}
          multiline
        />
        <p className="text-xs text-muted-foreground">{t('step2Body')}</p>
      </Step>

      <Step n={3} title={t('step3')}>
        <p className="text-sm text-muted-foreground">{t('step3Body')}</p>
        {keyEvents}
      </Step>

      <Step n={4} title={t('step4')}>
        <div
          aria-live="polite"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4 text-sm"
        >
          {last ? (
            <>
              <CheckCircle2Icon aria-hidden className="size-4 text-ok" />
              <span className="min-w-48 flex-1 break-words">
                {t('arrived', { event: last.event, time: relative(last.at) })}
              </span>
              <Button asChild size="sm">
                <Link href={usageHref}>
                  {t('openUsage')}
                  <ArrowRightIcon data-icon="inline-end" aria-hidden />
                </Link>
              </Button>
            </>
          ) : (
            <>
              <LoaderCircleIcon aria-hidden className="size-4 animate-spin text-muted-foreground" />
              <span className="flex-1 text-muted-foreground">{t('waitingBody')}</span>
            </>
          )}
        </div>
      </Step>
    </ol>
  )
}
