'use client'

import { createProjectAction } from '@/actions/projects'
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
} from './ui/dialog'
import { Input } from './ui/input'

export interface NewProductLabels {
  title: string
  intro: string
  name: string
  placeholder: string
  cancel: string
  create: string
}

/** A product is created with its name only; the action opens its page. */
export function NewProductDialog({
  open,
  onOpenChange,
  labels,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  labels: NewProductLabels
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.intro}</DialogDescription>
        </DialogHeader>
        <ActionForm action={createProjectAction} className="flex flex-col gap-5">
          <Field label={labels.name}>
            <Input name="name" maxLength={80} required autoFocus placeholder={labels.placeholder} />
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="lg">
                {labels.cancel}
              </Button>
            </DialogClose>
            <SubmitButton size="lg">{labels.create}</SubmitButton>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  )
}
