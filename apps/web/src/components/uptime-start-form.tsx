'use client'

import { createMonitorAction } from '@/actions/monitors'
import { ActionForm } from './action-form'
import { Field } from './field'
import { SubmitButton } from './submit-button'
import { Input } from './ui/input'

/**
 * The first step of an empty Uptime page: the site's address and one click.
 * The monitor checks it every minute; the rest is in the full form.
 */
export function UptimeStartForm({
  slug,
  name,
  label,
  hint,
  submit,
}: {
  slug: string
  /** The monitor's name: "Site". */
  name: string
  label: string
  hint: string
  submit: string
}) {
  return (
    <ActionForm action={createMonitorAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="kind" value="site" />
      <input type="hidden" name="interval" value="60" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Field label={label} hint={hint}>
            <Input
              name="url"
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="https://"
              required
            />
          </Field>
        </div>
        <SubmitButton className="sm:mb-6">{submit}</SubmitButton>
      </div>
    </ActionForm>
  )
}
