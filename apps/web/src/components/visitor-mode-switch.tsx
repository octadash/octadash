'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useId, useState, useTransition } from 'react'
import { setVisitorModeAction } from '@/actions/traffic'
import { InfoTip } from './info-tip'
import { Label } from './ui/label'
import { Switch } from './ui/switch'

/** "Count returning visitors" for one source, saved as it is switched. */
export function VisitorModeSwitch({
  slug,
  sourceId,
  persistent,
  disabled,
}: {
  slug: string
  sourceId: string
  persistent: boolean
  disabled: boolean
}) {
  const t = useTranslations('trafficSetup')
  const id = useId()
  const [on, setOn] = useState(persistent)
  const [, startTransition] = useTransition()
  useEffect(() => setOn(persistent), [persistent])
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        checked={on}
        disabled={disabled}
        aria-describedby={`${id}-body`}
        onCheckedChange={(value) => {
          setOn(value)
          const form = new FormData()
          form.set('slug', slug)
          form.set('source', sourceId)
          form.set('mode', value ? 'persistent' : 'daily')
          startTransition(() => setVisitorModeAction(form))
        }}
      />
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-1">
          <Label htmlFor={id}>{t('returning')}</Label>
          <InfoTip label={t('returningInfoLabel')} title={t('returning')}>
            {t('returningInfo')}
          </InfoTip>
        </span>
        <p id={`${id}-body`} className="text-xs text-muted-foreground">
          {t('returningBody')}
        </p>
      </div>
    </div>
  )
}
