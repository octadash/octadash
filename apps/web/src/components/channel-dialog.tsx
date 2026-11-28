'use client'

import { type ReactNode, useId, useState } from 'react'
import { saveChannelAction } from '@/actions/channels'
import { cn } from '@/lib/utils'
import { ActionForm } from './action-form'
import { Field } from './field'
import { SubmitButton } from './submit-button'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

/** One input of an integration's form, with its words already translated. */
export interface ChannelField {
  key: string
  type: 'text' | 'number' | 'boolean'
  required: boolean
  secret: boolean
  default?: string | number | boolean
  label: string
  hint?: string
  placeholder?: string
}

export interface ChannelType {
  id: string
  name: string
  description: string
  docsUrl?: string
  fields: ChannelField[]
}

export interface ChannelValues {
  id?: string
  integration: string
  name: string
  locale: string
  config: Record<string, unknown>
  /** Keys of the secrets already saved; their values never reach the browser. */
  savedSecrets: string[]
}

export interface ChannelDialogLabels {
  title: string
  intro: string
  type: string
  name: string
  namePlaceholder: string
  locale: string
  locales: { value: string; label: string }[]
  secretSaved: string
  docs: string
  cancel: string
  submit: string
}

/** Adds an alert channel, or edits one when `values.id` is set (the type is then fixed). */
export function ChannelDialog({
  trigger,
  types,
  values,
  labels,
}: {
  trigger: ReactNode
  types: ChannelType[]
  values: ChannelValues
  labels: ChannelDialogLabels
}) {
  const [open, setOpen] = useState(false)
  const [typeId, setTypeId] = useState(values.integration)
  const editing = Boolean(values.id)
  const type = types.find((t) => t.id === typeId) ?? types[0]
  const localeId = useId()

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setTypeId(values.integration)
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.intro}</DialogDescription>
        </DialogHeader>
        <ActionForm
          action={saveChannelAction}
          onDone={() => setOpen(false)}
          className="flex flex-col gap-5"
        >
          {values.id && <input type="hidden" name="channelId" value={values.id} />}

          {!editing && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-medium">{labels.type}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {types.map((option) => (
                  <label
                    key={option.id}
                    className={cn(
                      'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors',
                      typeId === option.id
                        ? 'border-brand bg-secondary'
                        : 'border-input hover:bg-secondary/60',
                    )}
                  >
                    <input
                      type="radio"
                      name="integration"
                      value={option.id}
                      checked={typeId === option.id}
                      onChange={() => setTypeId(option.id)}
                      className="sr-only"
                    />
                    <span className="font-medium">{option.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {type && (
            <p className="text-sm text-muted-foreground">
              {type.description}{' '}
              {type.docsUrl && (
                <a
                  href={type.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand underline-offset-4 hover:underline"
                >
                  {labels.docs}
                </a>
              )}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Field label={labels.name}>
              <Input
                name="name"
                defaultValue={values.name}
                placeholder={labels.namePlaceholder}
                maxLength={80}
                required
              />
            </Field>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={localeId}>{labels.locale}</Label>
              <Select name="locale" defaultValue={values.locale}>
                <SelectTrigger id={localeId} className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {labels.locales.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Keyed by type so switching type starts the fields fresh. */}
          <div key={type?.id} className="flex flex-col gap-4">
            {type?.fields.map((field) => (
              <ChannelInput
                key={field.key}
                field={field}
                value={editing ? values.config[field.key] : undefined}
                saved={values.savedSecrets.includes(field.key)}
                savedLabel={labels.secretSaved}
              />
            ))}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {labels.cancel}
              </Button>
            </DialogClose>
            <SubmitButton>{labels.submit}</SubmitButton>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  )
}

function ChannelInput({
  field,
  value,
  saved,
  savedLabel,
}: {
  field: ChannelField
  value: unknown
  saved: boolean
  savedLabel: string
}) {
  const id = useId()
  const name = `field.${field.key}`
  if (field.type === 'boolean') {
    const checked = typeof value === 'boolean' ? value : field.default === true
    return (
      <div className="flex items-start gap-2">
        <Checkbox id={id} name={name} defaultChecked={checked} className="mt-0.5" />
        <div className="flex flex-col gap-1">
          <Label htmlFor={id}>{field.label}</Label>
          {field.hint && <span className="text-xs text-muted-foreground">{field.hint}</span>}
        </div>
      </div>
    )
  }
  const initial = value ?? field.default
  return (
    <Field label={field.label} hint={field.hint}>
      <Input
        name={name}
        type={field.secret ? 'password' : field.type === 'number' ? 'number' : 'text'}
        defaultValue={field.secret || initial === undefined ? undefined : String(initial)}
        placeholder={field.secret && saved ? savedLabel : field.placeholder}
        required={field.required && !(field.secret && saved)}
        autoComplete={field.secret ? 'new-password' : 'off'}
      />
    </Field>
  )
}
