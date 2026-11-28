'use client'

import { TriangleIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { addNoteAction, closeEmergencyAction, takeEmergenciesAction } from '@/actions/emergencies'
import { ActionForm } from './action-form'
import { SubmitButton } from './submit-button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'

/** "I'm on it" or "Take over": the viewer takes this emergency. */
export function TakeButton({ incidentId, label }: { incidentId: string; label: string }) {
  return (
    <ActionForm action={takeEmergenciesAction}>
      <input type="hidden" name="incident" value={incidentId} />
      <SubmitButton>{label}</SubmitButton>
    </ActionForm>
  )
}

/** "Close anyway", with why: the reason goes on the record for everyone. */
export function CloseDialog({
  incidentId,
  labels,
}: {
  incidentId: string
  labels: { trigger: string; title: string; body: string; why: string; cancel: string }
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost">{labels.trigger}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.title}</AlertDialogTitle>
          <AlertDialogDescription>{labels.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <ActionForm
          action={closeEmergencyAction}
          onDone={() => setOpen(false)}
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="incident" value={incidentId} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={id}>{labels.why}</Label>
            <Textarea id={id} name="note" required maxLength={2000} />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <SubmitButton>{labels.trigger}</SubmitButton>
          </div>
        </ActionForm>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** A team note at the end of "What happened". */
export function NoteForm({
  incidentId,
  labels,
}: {
  incidentId: string
  labels: { placeholder: string; add: string }
}) {
  // A new key after each note gives an empty field.
  const [round, setRound] = useState(0)
  return (
    <ActionForm
      key={round}
      action={addNoteAction}
      onDone={() => setRound((n) => n + 1)}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="incident" value={incidentId} />
      <div className="flex gap-2">
        <Input
          name="note"
          required
          maxLength={2000}
          placeholder={labels.placeholder}
          aria-label={labels.placeholder}
        />
        <SubmitButton variant="secondary">{labels.add}</SubmitButton>
      </div>
    </ActionForm>
  )
}

export interface SameTimeItem {
  id: string
  /** "Acme Blog · Site". */
  name: string
  /** "nobody on it", "Ana is on it". */
  who: string
}

/** Other emergencies open now: tick the ones one fix covers and take them all at once. */
export function SameTimeForm({
  items,
  labels,
}: {
  items: SameTimeItem[]
  labels: { legend: string; submit: string }
}) {
  const base = useId()
  return (
    <ActionForm action={takeEmergenciesAction} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{labels.legend}</legend>
        {items.map((item, i) => (
          <div key={item.id} className="flex items-center gap-2 text-sm">
            <Checkbox id={`${base}-${i}`} name="incident" value={item.id} />
            <Label
              htmlFor={`${base}-${i}`}
              className="flex flex-1 items-center gap-1.5 font-normal"
            >
              <TriangleIcon className="size-3 fill-current text-error" aria-hidden />
              {item.name}
            </Label>
            <span className="text-xs text-muted-foreground">{item.who}</span>
          </div>
        ))}
      </fieldset>
      <SubmitButton variant="outline" size="sm" className="self-start">
        {labels.submit}
      </SubmitButton>
    </ActionForm>
  )
}
