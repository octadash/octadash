'use client'

import { TriangleAlertIcon } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { createMonitorAction, updateMonitorAction } from '@/actions/monitors'
import { cn } from '@/lib/utils'
import { ActionForm } from './action-form'
import { Field } from './field'
import { SubmitButton } from './submit-button'
import { Button } from './ui/button'
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

type Kind = 'site' | 'health' | 'heartbeat'

export interface MonitorDialogLabels {
  title: string
  intro: string
  name: string
  kind: string
  kinds: Record<Kind, { label: string; hint: string }>
  url: string
  interval: string
  intervalHeartbeat: string
  grace: string
  graceHint: string
  wakeTitle: string
  wakeBody: string
  cancel: string
  submit: string
}

export interface MonitorValues {
  id?: string
  name: string
  kind: Kind
  url: string
  interval: number
  grace: number
}

/** Adds a monitor, or edits one when `values.id` is set (the type is then fixed). */
export function MonitorDialog({
  slug,
  trigger,
  values,
  intervals,
  graces,
  labels,
}: {
  slug: string
  trigger: ReactNode
  values: MonitorValues
  intervals: { value: number; label: string }[]
  graces: { value: number; label: string }[]
  labels: MonitorDialogLabels
}) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>(values.kind)
  const [interval, setInterval] = useState(String(values.interval))
  const editing = Boolean(values.id)
  const ids = { interval: useId(), grace: useId() }
  // A page checked often wakes the database behind it; /health does not.
  const wakes = kind === 'site' && Number(interval) < 300

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setKind(values.kind)
          setInterval(String(values.interval))
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.intro}</DialogDescription>
        </DialogHeader>
        <ActionForm
          action={editing ? updateMonitorAction : createMonitorAction}
          onDone={() => setOpen(false)}
          className="flex flex-col gap-5"
        >
          <input type="hidden" name="slug" value={slug} />
          {values.id && <input type="hidden" name="monitorId" value={values.id} />}

          {!editing && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-medium">{labels.kind}</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {(['site', 'health', 'heartbeat'] as const).map((option) => (
                  <label
                    key={option}
                    className={cn(
                      'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors',
                      kind === option
                        ? 'border-brand bg-secondary'
                        : 'border-input hover:bg-secondary/60',
                    )}
                  >
                    <input
                      type="radio"
                      name="kind"
                      value={option}
                      checked={kind === option}
                      onChange={() => {
                        setKind(option)
                        if (option !== 'heartbeat' && Number(interval) > 3600) setInterval('3600')
                      }}
                      className="sr-only"
                    />
                    <span className="font-medium">{labels.kinds[option].label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{labels.kinds[kind].hint}</p>
            </fieldset>
          )}
          {editing && <input type="hidden" name="kind" value={kind} />}

          <Field label={labels.name}>
            <Input name="name" defaultValue={values.name} maxLength={80} required />
          </Field>

          {kind !== 'heartbeat' && (
            <Field label={labels.url}>
              <Input
                name="url"
                defaultValue={values.url}
                placeholder={
                  kind === 'health' ? 'https://api.example.com/health' : 'https://example.com'
                }
                inputMode="url"
                autoComplete="off"
                required
              />
            </Field>
          )}

          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ids.interval}>
                {kind === 'heartbeat' ? labels.intervalHeartbeat : labels.interval}
              </Label>
              <Select name="interval" value={interval} onValueChange={setInterval}>
                <SelectTrigger id={ids.interval} className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {intervals
                    .filter((option) => kind === 'heartbeat' || option.value <= 3600)
                    .map((option) => (
                      <SelectItem key={option.value} value={String(option.value)}>
                        {option.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {kind === 'heartbeat' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ids.grace}>{labels.grace}</Label>
                <Select name="grace" defaultValue={String(values.grace)}>
                  <SelectTrigger id={ids.grace} className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {graces.map((option) => (
                      <SelectItem key={option.value} value={String(option.value)}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {kind === 'heartbeat' && (
            <p className="-mt-3 text-xs text-muted-foreground">{labels.graceHint}</p>
          )}

          {wakes && (
            <div className="flex gap-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warn" />
              <div className="flex flex-col gap-1">
                <p className="font-medium">{labels.wakeTitle}</p>
                <p className="text-muted-foreground">{labels.wakeBody}</p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="lg">
                {labels.cancel}
              </Button>
            </DialogClose>
            <SubmitButton size="lg">{labels.submit}</SubmitButton>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  )
}
