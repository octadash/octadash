'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { startErrorsAction } from '@/actions/error-sources'
import { ERROR_PLATFORMS, type ErrorPlatform } from '@/lib/errors-setup'
import { Option, OptionGroup } from './choice'
import { SubmitButton } from './submit-button'

/**
 * Step 1 of the empty Errors page when the product has no source: where the
 * code runs. One click makes the source and the page shows its code.
 */
export function ErrorsStart({ slug }: { slug: string }) {
  const t = useTranslations('errorsArea.start')
  const tp = useTranslations('platforms')
  const [platform, setPlatform] = useState<ErrorPlatform>('html')
  return (
    <form action={startErrorsAction} className="flex flex-col gap-4">
      <input type="hidden" name="slug" value={slug} />
      <OptionGroup legend={t('where')}>
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
      <p className="text-sm text-muted-foreground">
        {platform === 'html'
          ? t('whereScript')
          : platform === 'other'
            ? t('whereOther')
            : t('whereSdk')}
      </p>
      <SubmitButton className="self-start">{t('showCode')}</SubmitButton>
    </form>
  )
}
