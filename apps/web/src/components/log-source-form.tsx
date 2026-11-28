'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { addLogSourceAction } from '@/actions/logs'
import { LOG_SOURCE_PLATFORMS } from '@/lib/logs-setup'
import { ActionForm } from './action-form'
import { Option, OptionGroup } from './choice'
import { Field } from './field'
import { SubmitButton } from './submit-button'
import { Input } from './ui/input'

/** "Add source" on Set up Logs: a name and the language the service is written in. */
export function LogSourceForm({ slug }: { slug: string }) {
  const t = useTranslations('errorsSetup')
  const tp = useTranslations('platforms')
  const [platform, setPlatform] = useState<(typeof LOG_SOURCE_PLATFORMS)[number]>('dotnet')
  return (
    <ActionForm action={addLogSourceAction}>
      <input type="hidden" name="slug" value={slug} />
      <Field label={t('name')} hint={t('nameHint')}>
        <Input name="name" required maxLength={80} placeholder={t('namePlaceholder')} />
      </Field>
      <OptionGroup legend={t('platform')}>
        {LOG_SOURCE_PLATFORMS.map((p) => (
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
