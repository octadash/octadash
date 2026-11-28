'use client'

import { ExternalLinkIcon, LinkIcon, TvIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useId, useState, useTransition } from 'react'
import { createTvLinkAction, stopTvLinkAction } from '@/actions/tv'
import {
  TV_MAX_METRICS,
  TV_METRICS,
  TV_PER_PAGE,
  type TvMetric,
  type TvSettings,
  tvHref,
} from '@/lib/tv'
import { CopyField } from './copy-field'
import { InfoTip } from './info-tip'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { Label } from './ui/label'
import { NativeSelect, NativeSelectOption } from './ui/native-select'
import { Switch } from './ui/switch'

interface LinkInfo {
  by: string | null
  createdAt: number
  lastOpenedAt: number | null
  settings: TvSettings
}

function Row({
  title,
  body,
  children,
  htmlFor,
}: {
  title: string
  body: string
  children: React.ReactNode
  htmlFor?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
      <div className="flex min-w-48 flex-1 flex-col gap-0.5">
        {htmlFor ? (
          <Label htmlFor={htmlFor}>{title}</Label>
        ) : (
          <span className="text-sm font-medium">{title}</span>
        )}
        <p className="text-xs text-muted-foreground">{body}</p>
      </div>
      {children}
    </div>
  )
}

/** The TV settings: what to show, how, and the private link for a TV that is not signed in. */
export function TvDialog({
  initial,
  scopes,
  link,
  manager,
}: {
  initial: TvSettings
  scopes: { value: string; label: string }[]
  link: LinkInfo | null
  manager: boolean
}) {
  const t = useTranslations('tvDialog')
  const tm = useTranslations('tv.metric')
  const tc = useTranslations('common')
  const format = useFormatter()
  const id = useId()
  const [scope, setScope] = useState(initial.scope)
  const [metrics, setMetrics] = useState<TvMetric[]>(initial.metrics)
  const [perPage, setPerPage] = useState(initial.perPage)
  const [sound, setSound] = useState(initial.sound)
  const [token, setToken] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const settings: TvSettings = { scope, metrics, perPage, sound }
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  const toggle = (metric: TvMetric, on: boolean) =>
    setMetrics((list) =>
      on
        ? [...list, metric].slice(0, TV_MAX_METRICS)
        : list.length > 1
          ? list.filter((m) => m !== metric)
          : list,
    )

  return (
    <Dialog onOpenChange={(open) => !open && setToken(null)}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <TvIcon data-icon="inline-start" aria-hidden />
          {t('open')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Row title={t('show')} body={t('showBody')} htmlFor={`${id}-scope`}>
            <NativeSelect
              id={`${id}-scope`}
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              {scopes.map((s) => (
                <NativeSelectOption key={s.value} value={s.value}>
                  {s.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Row>

          <fieldset className="flex flex-col gap-2 border-t border-border pt-4">
            <legend className="sr-only">{t('numbers')}</legend>
            <span aria-hidden className="text-sm font-medium">
              {t('numbers')}
            </span>
            <p className="text-xs text-muted-foreground">
              {t('numbersBody', { count: TV_MAX_METRICS })}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {TV_METRICS.map((m) => {
                const checked = metrics.includes(m)
                return (
                  <Label key={m} className="flex items-center gap-2 font-normal">
                    <Checkbox
                      checked={checked}
                      disabled={!checked && metrics.length >= TV_MAX_METRICS}
                      onCheckedChange={(value) => toggle(m, value === true)}
                    />
                    {tm(m)}
                  </Label>
                )
              })}
            </div>
          </fieldset>

          <Row title={t('perPage')} body={t('perPageBody')} htmlFor={`${id}-per`}>
            <NativeSelect
              id={`${id}-per`}
              value={String(perPage)}
              onChange={(event) => setPerPage(Number(event.target.value))}
            >
              {TV_PER_PAGE.map((n) => (
                <NativeSelectOption key={n} value={n}>
                  {t('perPageValue', { count: n })}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Row>

          <Row title={t('sound')} body={t('soundBody')} htmlFor={`${id}-sound`}>
            <Switch id={`${id}-sound`} checked={sound} onCheckedChange={setSound} />
          </Row>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <span className="flex items-center gap-1 text-sm font-medium">
              {t('link')}
              <InfoTip label={t('linkInfoLabel')} title={t('link')}>
                {t('linkInfo')}
              </InfoTip>
            </span>
            {token ? (
              <>
                <CopyField
                  value={`${origin}/tv/${token}`}
                  label={t('link')}
                  copyLabel={tc('copy')}
                  copiedLabel={tc('copied')}
                />
                <p className="text-xs text-muted-foreground">{t('linkOnce')}</p>
              </>
            ) : link ? (
              <p className="text-xs text-muted-foreground">
                {t('linkMade', {
                  name: link.by ?? '?',
                  date: format.dateTime(link.createdAt, { dateStyle: 'medium' }),
                })}
                {' · '}
                {link.lastOpenedAt
                  ? t('linkOpened', { time: format.relativeTime(link.lastOpenedAt) })
                  : t('linkNeverOpened')}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{t('linkNone')}</p>
            )}
            {manager ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await createTvLinkAction(settings)
                      setToken(result.token)
                    })
                  }
                >
                  <LinkIcon data-icon="inline-start" aria-hidden />
                  {link || token ? t('linkNew') : t('linkCreate')}
                </Button>
                {(link || token) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await stopTvLinkAction()
                        setToken(null)
                      })
                    }
                  >
                    {t('linkStop')}
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t('linkManagers')}</p>
            )}
            <p role="status" className="sr-only">
              {token ? t('linkReady') : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {tc('cancel')}
            </Button>
          </DialogClose>
          <Button asChild>
            <a href={tvHref(settings)} target="_blank" rel="noopener">
              <ExternalLinkIcon data-icon="inline-start" aria-hidden />
              {t('start')}
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
