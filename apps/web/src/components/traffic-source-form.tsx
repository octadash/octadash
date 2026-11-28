'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { addTrafficSourceAction } from '@/actions/traffic'
import { TRAFFIC_PLATFORMS, type TrafficPlatform } from '@/lib/traffic-setup'
import { ActionForm } from './action-form'
import { Option, OptionGroup } from './choice'
import { Field } from './field'
import { SubmitButton } from './submit-button'
import { Input } from './ui/input'

/** "Add source" on Set up Traffic: a name and where it runs. */
export function TrafficSourceForm({ slug }: { slug: string }) {
  const t = useTranslations('trafficSetup')
  const [platform, setPlatform] = useState<TrafficPlatform>('html')
  return (
    <ActionForm action={addTrafficSourceAction}>
      <input type="hidden" name="slug" value={slug} />
      <Field label={t('name')} hint={t('nameHint')}>
        <Input name="name" required maxLength={80} placeholder={t('namePlaceholder')} />
      </Field>
      <OptionGroup legend={t('platform')}>
        {TRAFFIC_PLATFORMS.map((p) => (
          <Option
            key={p}
            name="platform"
            value={p}
            checked={platform === p}
            onChange={() => setPlatform(p)}
          >
            {t(`platforms.${p}`)}
          </Option>
        ))}
      </OptionGroup>
      <SubmitButton className="self-start">{t('create')}</SubmitButton>
    </ActionForm>
  )
}
