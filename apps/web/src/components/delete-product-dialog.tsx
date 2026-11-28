'use client'

import { useState } from 'react'
import { deleteProjectAction } from '@/actions/projects'
import { ActionForm } from './action-form'
import { Field } from './field'
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
import { Input } from './ui/input'

/** Deleting a product asks for its name, typed, so it never happens by a slip. */
export function DeleteProductDialog({
  projectId,
  name,
  labels,
}: {
  projectId: string
  name: string
  labels: {
    trigger: string
    title: string
    body: string
    typeName: string
    cancel: string
    confirm: string
  }
}) {
  const [typed, setTyped] = useState('')
  return (
    <AlertDialog onOpenChange={(open) => !open && setTyped('')}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="shrink-0 border-destructive/50 text-destructive">
          {labels.trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.title}</AlertDialogTitle>
          <AlertDialogDescription>{labels.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <ActionForm action={deleteProjectAction} className="flex flex-col gap-3">
          <input type="hidden" name="projectId" value={projectId} />
          <Field label={labels.typeName}>
            <Input
              name="confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <SubmitButton variant="destructive" disabled={typed.trim() !== name}>
              {labels.confirm}
            </SubmitButton>
          </div>
        </ActionForm>
      </AlertDialogContent>
    </AlertDialog>
  )
}
