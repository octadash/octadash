'use client'

import { ArrowRightIcon, CheckCircle2Icon, LoaderCircleIcon } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useId, useState, useTransition } from 'react'
import { setVisitorModeAction } from '@/actions/traffic'
import { TRAFFIC_PLATFORMS, type TrafficPlatform, trafficSnippet } from '@/lib/traffic-setup'
import { CopyField } from './copy-field'
import { InfoTip } from './info-tip'
import { Button } from './ui/button'
import { Label } from './ui/label'
import { Switch } from './ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

/** How often step 3 asks whether a page view arrived. */
const POLL_MS = 3000

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
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
 * Steps 1 to 3 of Set up Traffic for one source: the code for each platform
 * (the options change it as they are switched), the options, and a live wait
 * for the first page view.
 */
export function TrafficInstall({
  slug,
  sourceId,
  ingestUrl,
  publicKey,
  platform,
  persistent,
  manager,
  trafficHref,
}: {
  slug: string
  sourceId: string
  ingestUrl: string
  publicKey: string
  platform: TrafficPlatform
  persistent: boolean
  manager: boolean
  trafficHref: string
}) {
  const t = useTranslations('trafficSetup')
  const tp = useTranslations('platforms')
  const locale = useLocale()
  const ids = useId()
  const [tab, setTab] = useState<TrafficPlatform>(platform)
  const [returning, setReturning] = useState(persistent)
  const [local, setLocal] = useState(false)
  const [, startTransition] = useTransition()
  const [last, setLast] = useState<{ at: string; path: string } | null>(null)

  // Keeps the switch where the server has it after a save from another tab.
  useEffect(() => setReturning(persistent), [persistent])

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = async () => {
      try {
        const response = await fetch(`/api/traffic/last?source=${encodeURIComponent(sourceId)}`, {
          cache: 'no-store',
        })
        if (response.ok) {
          const data = (await response.json()) as { at: string; path: string } | null
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

  const saveReturning = (on: boolean) => {
    setReturning(on)
    const form = new FormData()
    form.set('slug', slug)
    form.set('source', sourceId)
    form.set('mode', on ? 'persistent' : 'daily')
    startTransition(() => setVisitorModeAction(form))
  }

  const options = { ingestUrl, publicKey, persistent: returning, local }
  const relative = (iso: string) => {
    const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    if (Math.abs(seconds) < 60) return rtf.format(seconds, 'second')
    if (Math.abs(seconds) < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
    return rtf.format(Math.round(seconds / 3600), 'hour')
  }

  return (
    <ol className="flex flex-col gap-6">
      <Step n={1} title={t(`step1.${tab}`)}>
        <Tabs value={tab} onValueChange={(v) => setTab(v as TrafficPlatform)} className="gap-2">
          <TabsList
            aria-label={t('codeLabel')}
            className="max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto"
          >
            {TRAFFIC_PLATFORMS.map((p) => (
              <TabsTrigger key={p} value={p} className="h-8 flex-none px-2.5">
                {tp(p)}
              </TabsTrigger>
            ))}
          </TabsList>
          {TRAFFIC_PLATFORMS.map((p) => {
            const snippet = trafficSnippet(p, options)
            return (
              <TabsContent key={p} value={p} className="flex flex-col gap-2">
                <p className="font-mono text-xs text-muted-foreground">{snippet.file}</p>
                <CopyField
                  value={snippet.code}
                  copyLabel={t('copy')}
                  copiedLabel={t('copied')}
                  multiline
                />
              </TabsContent>
            )
          })}
        </Tabs>
        <p className="text-xs text-muted-foreground">{t('step1Note')}</p>
      </Step>

      <Step n={2} title={t('step2')}>
        <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <div className="flex items-start gap-3">
            <Switch
              id={`${ids}-returning`}
              checked={returning}
              disabled={!manager}
              onCheckedChange={saveReturning}
              aria-describedby={`${ids}-returning-body`}
            />
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-1">
                <Label htmlFor={`${ids}-returning`}>{t('returning')}</Label>
                <InfoTip label={t('returningInfoLabel')} title={t('returning')}>
                  {t('returningInfo')}
                </InfoTip>
              </span>
              <p id={`${ids}-returning-body`} className="text-xs text-muted-foreground">
                {t('returningBody')}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Switch
              id={`${ids}-local`}
              checked={local}
              onCheckedChange={setLocal}
              aria-describedby={`${ids}-local-body`}
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor={`${ids}-local`}>{t('local')}</Label>
              <p id={`${ids}-local-body`} className="text-xs text-muted-foreground">
                {t('localBody')}
              </p>
            </div>
          </div>
          {!manager && <p className="text-xs text-muted-foreground">{t('readOnly')}</p>}
        </div>
      </Step>

      <Step n={3} title={t('step3')}>
        <div
          aria-live="polite"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4 text-sm"
        >
          {last ? (
            <>
              <CheckCircle2Icon aria-hidden className="size-4 text-ok" />
              <span className="min-w-48 flex-1">
                {t('arrived', { path: last.path || '/', time: relative(last.at) })}
              </span>
              <Button asChild size="sm">
                <Link href={trafficHref}>
                  {t('openTraffic')}
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
