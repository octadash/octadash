'use client'

import { ArrowRightIcon, CheckCircle2Icon, LoaderCircleIcon } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { ERROR_PLATFORMS, type ErrorPlatform, errorSnippet, testError } from '@/lib/errors-setup'
import { CopyField } from './copy-field'
import { Button } from './ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

/** How often step 3 asks whether an error arrived. */
const POLL_MS = 3000

function Step({
  n,
  title,
  level,
  children,
}: {
  n: number
  title: string
  level: 2 | 3
  children: React.ReactNode
}) {
  const Heading = level === 2 ? 'h2' : 'h3'
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Heading className="text-sm font-semibold">{title}</Heading>
        {children}
      </div>
    </li>
  )
}

type Test = 'idle' | 'sending' | 'sent' | 'failed'

/**
 * The two steps of Set up Errors for one source, as on the empty Errors
 * page: the code for each platform, then a test error sent from this browser
 * with a live wait for the first error.
 */
export function ErrorsInstall({
  sourceId,
  ingestUrl,
  publicKey,
  dsn,
  platform,
  issueHref,
  errorsHref,
  level = 3,
}: {
  sourceId: string
  ingestUrl: string
  publicKey: string
  dsn: string
  platform: ErrorPlatform
  /** The product's issue page, without the id. */
  issueHref: string
  errorsHref: string
  /** The steps' heading level: 2 on the empty Errors page, 3 under a card title. */
  level?: 2 | 3
}) {
  const t = useTranslations('errorsSetup')
  const tp = useTranslations('platforms')
  const locale = useLocale()
  const [tab, setTab] = useState<ErrorPlatform>(platform)
  const [test, setTest] = useState<Test>('idle')
  const [last, setLast] = useState<{
    at: string
    type: string
    value: string
    issue: string
  } | null>(null)

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = async () => {
      try {
        const response = await fetch(`/api/errors/last?source=${encodeURIComponent(sourceId)}`, {
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

  const sendTest = async () => {
    setTest('sending')
    try {
      const response = await fetch(`${ingestUrl.replace(/\/+$/, '')}/o/v1/errors`, {
        method: 'POST',
        body: JSON.stringify(testError(publicKey)),
      })
      setTest(response.ok ? 'sent' : 'failed')
    } catch {
      setTest('failed')
    }
  }

  const options = { ingestUrl, publicKey, dsn }
  const relative = (iso: string) => {
    const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    if (Math.abs(seconds) < 60) return rtf.format(seconds, 'second')
    if (Math.abs(seconds) < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
    return rtf.format(Math.round(seconds / 3600), 'hour')
  }

  return (
    <ol className="flex flex-col gap-6">
      <Step n={1} title={t('step1')} level={level}>
        <Tabs value={tab} onValueChange={(v) => setTab(v as ErrorPlatform)} className="gap-2">
          <TabsList
            aria-label={t('codeLabel')}
            className="max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto"
          >
            {ERROR_PLATFORMS.map((p) => (
              <TabsTrigger key={p} value={p} className="h-8 flex-none px-2.5">
                {tp(p)}
              </TabsTrigger>
            ))}
          </TabsList>
          {ERROR_PLATFORMS.map((p) => {
            const snippet = errorSnippet(p, options)
            return (
              <TabsContent key={p} value={p} className="flex flex-col gap-2">
                {snippet.install && (
                  <CopyField
                    value={snippet.install}
                    label={t('install')}
                    copyLabel={t('copy')}
                    copiedLabel={t('copied')}
                  />
                )}
                <p className="font-mono text-xs text-muted-foreground">{snippet.file}</p>
                <CopyField
                  value={snippet.code}
                  copyLabel={t('copy')}
                  copiedLabel={t('copied')}
                  multiline
                />
                <p className="text-xs text-muted-foreground">
                  {p === 'html' ? t('noteScript') : p === 'other' ? t('noteOther') : t('noteSdk')}
                </p>
              </TabsContent>
            )
          })}
        </Tabs>
      </Step>

      <Step n={2} title={t('step2')} level={level}>
        <p className="text-sm text-muted-foreground">{t('step2Body')}</p>
        {!last && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={sendTest}
              disabled={test === 'sending'}
            >
              {test === 'sending' && (
                <LoaderCircleIcon data-icon="inline-start" className="animate-spin" aria-hidden />
              )}
              {t('sendTest')}
            </Button>
            <p role="status" className="text-sm text-muted-foreground">
              {test === 'sent' ? t('testSent') : test === 'failed' ? t('testFailed') : ''}
            </p>
          </div>
        )}
        <div
          aria-live="polite"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4 text-sm"
        >
          {last ? (
            <>
              <CheckCircle2Icon aria-hidden className="size-4 text-ok" />
              <span className="min-w-48 flex-1 break-words">
                {t('arrived', {
                  error: [last.type, last.value].filter(Boolean).join(': '),
                  time: relative(last.at),
                })}
              </span>
              <Button asChild size="sm" variant="outline">
                <Link href={`${issueHref}/${last.issue}`}>{t('openIssue')}</Link>
              </Button>
              <Button asChild size="sm">
                <Link href={errorsHref}>
                  {t('openErrors')}
                  <ArrowRightIcon data-icon="inline-end" aria-hidden />
                </Link>
              </Button>
            </>
          ) : (
            <>
              <span aria-hidden className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2.5 rounded-full bg-brand" />
              </span>
              <span className="flex-1 text-muted-foreground">{t('waitingBody')}</span>
            </>
          )}
        </div>
      </Step>
    </ol>
  )
}
