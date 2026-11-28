'use client'

import { useState } from 'react'
import { deleteOrgAction } from '@/actions/organization'
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

/** Deleting an organization asks to type its name, so it never happens by a slip. */
export function DeleteOrgDialog({
  name,
  labels,
}: {
  name: string
  labels: {
    trigger: string
    title: string
    body: string
    type: string
    cancel: string
    confirm: string
  }
}) {
  const [typed, setTyped] = useState('')
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="self-start">
          {labels.trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.title}</AlertDialogTitle>
          <AlertDialogDescription>{labels.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <ActionForm action={deleteOrgAction} className="flex flex-col gap-4">
          <Field label={labels.type}>
            <Input
              name="confirm"
              autoComplete="off"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
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
