'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { Option } from './choice'
import { Field } from './field'
import { Input } from './ui/input'

/** A fixed bill: name, amount, currency, every month or year, since when. */
export function FixedBillFields({
  name,
  amount,
  currency,
  every: initialEvery = 'month',
  startsOn,
}: {
  name?: string
  /** As typed, in major units. */
  amount?: string
  currency: string
  every?: 'month' | 'year'
  startsOn: string
}) {
  const t = useTranslations('costsSetup.bill')
  const [every, setEvery] = useState(initialEvery)
  return (
    <div className="flex flex-col gap-3">
      <Field label={t('name')} hint={t('nameHint')}>
        <Input name="name" required maxLength={80} defaultValue={name} placeholder="Hetzner VPS" />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field label={t('amount')}>
          <Input
            name="amount"
            required
            inputMode="decimal"
            defaultValue={amount}
            placeholder="49.90"
            className="w-36 tabular-nums"
          />
        </Field>
        <Field label={t('currency')} hint={t('currencyHint')}>
          <Input
            name="currency"
            required
            maxLength={3}
            defaultValue={currency}
            className="w-24 font-mono uppercase"
          />
        </Field>
        <Field label={t('startsOn')}>
          <Input name="startsOn" type="date" required defaultValue={startsOn} className="w-44" />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-sm font-medium">{t('every')}</legend>
        <div className="flex flex-wrap gap-2">
          {(['month', 'year'] as const).map((value) => (
            <Option
              key={value}
              name="every"
              value={value}
              checked={every === value}
              onChange={() => setEvery(value)}
            >
              {t(`everyOf.${value}`)}
            </Option>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t('everyHint')}</p>
      </fieldset>
    </div>
  )
}
