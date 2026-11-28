'use client'

import { deleteGroupAction } from '@/actions/groups'
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

export function DeleteGroupDialog({
  groupId,
  labels,
}: {
  groupId: string
  labels: { trigger: string; title: string; body: string; cancel: string }
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" className="self-start text-muted-foreground hover:text-destructive">
          {labels.trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.title}</AlertDialogTitle>
          <AlertDialogDescription>{labels.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <ActionForm action={deleteGroupAction} className="flex flex-col gap-3">
          <input type="hidden" name="groupId" value={groupId} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <SubmitButton variant="destructive">{labels.trigger}</SubmitButton>
          </div>
        </ActionForm>
      </AlertDialogContent>
    </AlertDialog>
  )
}
