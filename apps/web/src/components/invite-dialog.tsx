'use client'

import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { inviteAction } from '@/actions/invitations'
import { ActionForm } from './action-form'
import { Field } from './field'
import { FormNotice } from './form-notice'
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
import { NativeSelect, NativeSelectOption } from './ui/native-select'

/**
 * Invite: email and role. Says whether the email went out through the email
 * channel, or that the link is to be copied from the list.
 */
export function InviteDialog({
  labels,
}: {
  labels: {
    trigger: string
    title: string
    intro: string
    email: string
    role: string
    roleHint: string
    admin: string
    member: string
    send: string
    close: string
  }
}) {
  const [round, setRound] = useState(0)
  return (
    <Dialog onOpenChange={(open) => open && setRound((n) => n + 1)}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon />
          {labels.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.intro}</DialogDescription>
        </DialogHeader>
        <ActionForm key={round} action={inviteAction}>
          <Field label={labels.email}>
            <Input name="email" type="email" autoComplete="off" required />
          </Field>
          <Field label={labels.role} hint={labels.roleHint}>
            <NativeSelect name="role" defaultValue="member">
              <NativeSelectOption value="member">{labels.member}</NativeSelectOption>
              <NativeSelectOption value="admin">{labels.admin}</NativeSelectOption>
            </NativeSelect>
          </Field>
          <FormNotice />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {labels.close}
              </Button>
            </DialogClose>
            <SubmitButton>{labels.send}</SubmitButton>
          </div>
        </ActionForm>
      </DialogContent>
    </Dialog>
  )
}
