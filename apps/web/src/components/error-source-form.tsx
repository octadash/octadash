'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { addErrorSourceAction } from '@/actions/error-sources'
import {
  ERROR_PLATFORMS_BY_RUNTIME,
  ERROR_RUNTIMES,
  type ErrorPlatform,
  type ErrorRuntime,
} from '@/lib/errors-setup'
import { ActionForm } from './action-form'
import { Option, OptionGroup } from './choice'
import { Field } from './field'
import { SubmitButton } from './submit-button'
import { Input } from './ui/input'

/**
 * "Add source" on Set up Errors: a name, where the code runs (the browser or
 * a server), then the language or framework for that place.
 */
export function ErrorSourceForm({
  slug,
  runtime: startRuntime = 'browser',
}: {
  slug: string
  /** "+ Add a server source" opens the form on Server. */
  runtime?: ErrorRuntime
}) {
  const t = useTranslations('errorsSetup')
  const tp = useTranslations('platforms')
  const [runtime, setRuntime] = useState<ErrorRuntime>(startRuntime)
  const [platform, setPlatform] = useState<ErrorPlatform>(
    startRuntime === 'server' ? 'node' : 'nextjs',
  )
  const platforms = ERROR_PLATFORMS_BY_RUNTIME[runtime]
  const chooseRuntime = (next: ErrorRuntime) => {
    setRuntime(next)
    const list = ERROR_PLATFORMS_BY_RUNTIME[next]
    if (!list.includes(platform)) setPlatform(list[0] ?? 'other')
  }
  return (
    <ActionForm action={addErrorSourceAction}>
      <input type="hidden" name="slug" value={slug} />
      <Field label={t('name')} hint={t('nameHint')}>
        <Input name="name" required maxLength={80} placeholder={t('namePlaceholder')} />
      </Field>
      <div className="flex flex-col gap-1.5">
        <OptionGroup legend={t('runtime')}>
          {ERROR_RUNTIMES.map((r) => (
            <Option
              key={r}
              name="runtime"
              checked={runtime === r}
              onChange={() => chooseRuntime(r)}
            >
              {t(`runtimes.${r}`)}
            </Option>
          ))}
        </OptionGroup>
        <p className="text-xs text-muted-foreground">{t(`runtimeHints.${runtime}`)}</p>
      </div>
      <OptionGroup legend={t('platform')}>
        {platforms.map((p) => (
          <Option
            key={p}
            name="platform"
            value={p}
            checked={platform === p}
            onChange={() => setPlatform(p)}
          >
            {tp(p)}
          </Option>
        ))}
      </OptionGroup>
      <SubmitButton className="self-start">{t('create')}</SubmitButton>
    </ActionForm>
  )
}
