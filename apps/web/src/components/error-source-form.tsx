'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { addErrorSourceAction } from '@/actions/error-sources'
import { ERROR_PLATFORMS, type ErrorPlatform } from '@/lib/errors-setup'
import { ActionForm } from './action-form'
import { Option, OptionGroup } from './choice'
import { Field } from './field'
import { SubmitButton } from './submit-button'
import { Input } from './ui/input'

/** "Add source" on Set up Errors: a name and where the code runs. */
export function ErrorSourceForm({ slug }: { slug: string }) {
  const t = useTranslations('errorsSetup')
  const tp = useTranslations('platforms')
  const [platform, setPlatform] = useState<ErrorPlatform>('nextjs')
  return (
    <ActionForm action={addErrorSourceAction}>
      <input type="hidden" name="slug" value={slug} />
      <Field label={t('name')} hint={t('nameHint')}>
        <Input name="name" required maxLength={80} placeholder={t('namePlaceholder')} />
      </Field>
      <OptionGroup legend={t('platform')}>
        {ERROR_PLATFORMS.map((p) => (
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
