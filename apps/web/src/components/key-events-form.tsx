'use client'

import { useTranslations } from 'next-intl'
import { useId } from 'react'
import { saveKeyEventsAction } from '@/actions/usage'
import { ActionForm } from './action-form'
import { Field } from './field'
import { SubmitButton } from './submit-button'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'
import { Label } from './ui/label'

/**
 * Step 3 of Set up Product usage: the events seen in the last 7 days, each
 * with a box to mark it as key, and a name for one not seen yet.
 */
export function KeyEventsForm({
  slug,
  events,
  keys,
  canEdit,
}: {
  slug: string
  events: { event: string; count: number; normal: string }[]
  keys: string[]
  canEdit: boolean
}) {
  const t = useTranslations('usageSetup')
  const id = useId()
  const marked = new Set(keys)
  return (
    <ActionForm action={saveKeyEventsAction} doneMessage={t('keysSaved')}>
      <input type="hidden" name="slug" value={slug} />
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noEventsYet')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((e, i) => (
            <li
              key={e.event}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2"
            >
              <input type="hidden" name="shown" value={e.event} />
              <Checkbox
                id={`${id}-${i}`}
                name="key"
                value={e.event}
                defaultChecked={marked.has(e.event)}
                disabled={!canEdit}
              />
              <Label htmlFor={`${id}-${i}`} className="font-mono text-sm font-medium break-all">
                {e.event}
              </Label>
              <span className="text-xs text-muted-foreground">{e.normal}</span>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <>
          <Field label={t('newKey')} hint={t('newKeyHint')}>
            <Input
              name="new"
              maxLength={200}
              placeholder="purchase_completed"
              className="font-mono"
            />
          </Field>
          <SubmitButton className="self-start">{t('saveKeys')}</SubmitButton>
        </>
      )}
    </ActionForm>
  )
}
