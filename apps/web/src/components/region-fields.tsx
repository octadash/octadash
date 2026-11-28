'use client'

import { useEffect, useState } from 'react'
import { Field } from '@/components/field'
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select'
import { type Choice, currencyOfLocale } from '@/lib/region'

/**
 * Main currency and time zone, filled from the browser on first view (the
 * server can't know them). Native selects: long lists, typing jumps to a
 * match, and every screen reader knows them.
 */
export function RegionFields({
  currencies,
  zones,
  labels,
  hints,
  initial,
}: {
  currencies: Choice[]
  zones: { region: string; zones: Choice[] }[]
  labels: { currency: string; timeZone: string }
  /** What each choice changes, under the field. */
  hints?: { currency: string; timeZone: string }
  /** Saved values; without them the browser's guess wins. */
  initial?: { currency: string; timeZone: string }
}) {
  const [currency, setCurrency] = useState(initial?.currency ?? 'USD')
  const [timeZone, setTimeZone] = useState(initial?.timeZone ?? 'UTC')
  const [extraZone, setExtraZone] = useState<string | null>(null)

  useEffect(() => {
    if (initial) return
    const guessed = currencyOfLocale(navigator.language)
    if (currencies.some((c) => c.value === guessed)) setCurrency(guessed)
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!zone) return
    // Browsers may answer with an alias the list doesn't have ("Asia/Calcutta").
    if (!zones.some((g) => g.zones.some((z) => z.value === zone))) setExtraZone(zone)
    setTimeZone(zone)
  }, [initial, currencies, zones])

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={labels.currency} hint={hints?.currency}>
        <NativeSelect
          name="currency"
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          className="w-full"
        >
          {currencies.map((c) => (
            <NativeSelectOption key={c.value} value={c.value}>
              {c.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field label={labels.timeZone} hint={hints?.timeZone}>
        <NativeSelect
          name="timeZone"
          value={timeZone}
          onChange={(event) => setTimeZone(event.target.value)}
          className="w-full"
        >
          {extraZone && <NativeSelectOption value={extraZone}>{extraZone}</NativeSelectOption>}
          {zones.map((group) =>
            group.region ? (
              <NativeSelectOptGroup key={group.region} label={group.region}>
                {group.zones.map((z) => (
                  <NativeSelectOption key={z.value} value={z.value}>
                    {z.label}
                  </NativeSelectOption>
                ))}
              </NativeSelectOptGroup>
            ) : (
              group.zones.map((z) => (
                <NativeSelectOption key={z.value} value={z.value}>
                  {z.label}
                </NativeSelectOption>
              ))
            ),
          )}
        </NativeSelect>
      </Field>
    </div>
  )
}
