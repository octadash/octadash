'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { addUsageSourceAction } from '@/actions/usage'
import { USAGE_SOURCE_PLATFORMS } from '@/lib/usage-setup'
import { ActionForm } from './action-form'
import { Option, OptionGroup } from './choice'
import { Field } from './field'
import { SubmitButton } from './submit-button'
import { Input } from './ui/input'

/** "Add source" on Set up Product usage: a name and where the code runs. */
export function UsageSourceForm({ slug }: { slug: string }) {
  const t = useTranslations('errorsSetup')
  const tp = useTranslations('platforms')
  const [platform, setPlatform] = useState<(typeof USAGE_SOURCE_PLATFORMS)[number]>('nextjs')
  return (
    <ActionForm action={addUsageSourceAction}>
      <input type="hidden" name="slug" value={slug} />
      <Field label={t('name')} hint={t('nameHint')}>
        <Input name="name" required maxLength={80} placeholder={t('namePlaceholder')} />
      </Field>
      <OptionGroup legend={t('platform')}>
        {USAGE_SOURCE_PLATFORMS.map((p) => (
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
