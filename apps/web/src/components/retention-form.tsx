'use client'

import { useState } from 'react'
import { saveRetentionAction } from '@/actions/retention'
import { ActionForm } from './action-form'
import { SubmitButton } from './submit-button'
import { NativeSelect, NativeSelectOption } from './ui/native-select'

/**
 * One area's "keep for" choice in Product settings. Saving a shorter time
 * says first that older data goes away now.
 */
export function RetentionForm({
  slug,
  area,
  days,
  choices,
  canEdit,
  labels,
}: {
  slug: string
  area: string
  days: number
  choices: readonly number[]
  canEdit: boolean
  labels: {
    name: string
    hint: string
    /** "{count} days" per choice, already formatted. */
    choices: Record<number, string>
    shorter: string
    save: string
    saved: string
  }
}) {
  const [chosen, setChosen] = useState(days)
  const id = `retention-${area}`
  return (
    <ActionForm
      action={saveRetentionAction}
      doneMessage={chosen === days ? labels.saved : undefined}
      className="flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="area" value={area} />
      <div className="flex min-w-48 flex-1 flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {labels.name}
        </label>
        <p className="text-xs text-muted-foreground">
          {chosen < days ? <span className="text-warn">{labels.shorter}</span> : labels.hint}
        </p>
      </div>
      <NativeSelect
        id={id}
        name="days"
        value={String(chosen)}
        disabled={!canEdit}
        onChange={(event) => setChosen(Number(event.target.value))}
      >
        {choices.map((d) => (
          <NativeSelectOption key={d} value={String(d)}>
            {labels.choices[d]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {canEdit && chosen !== days && <SubmitButton size="sm">{labels.save}</SubmitButton>}
    </ActionForm>
  )
}
