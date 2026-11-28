'use client'

import { KeyRoundIcon, PlusIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { createApiTokenAction, revokeApiTokenAction } from '@/actions/api-tokens'
import { ActionForm } from './action-form'
import { CopyField } from './copy-field'
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

export interface NewTokenLabels {
  name: string
  nameHint: string
  namePlaceholder: string
  create: string
  token: string
  once: string
  command: string
  copy: string
  copied: string
}

/**
 * "New token": a name, then the token shown once with the command that adds
 * Octadash to Claude Code. Leaving the page loses it; a new one is cheap.
 */
export function NewApiToken({ mcpUrl, labels }: { mcpUrl: string; labels: NewTokenLabels }) {
  const [name, setName] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          start(async () => {
            const { token } = await createApiTokenAction(name)
            setToken(token)
            setName('')
          })
        }}
      >
        <div className="min-w-56 flex-1">
          <Field label={labels.name} hint={labels.nameHint}>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder={labels.namePlaceholder}
              required
            />
          </Field>
        </div>
        <Button type="submit" disabled={pending}>
          <PlusIcon data-icon="inline-start" aria-hidden />
          {labels.create}
        </Button>
      </form>
      {token && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-lg border border-brand/40 bg-brand/5 p-4"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <KeyRoundIcon aria-hidden className="size-4 text-brand" />
            {labels.once}
          </p>
          <CopyField
            value={token}
            label={labels.token}
            copyLabel={labels.copy}
            copiedLabel={labels.copied}
          />
          <span className="text-sm font-medium">{labels.command}</span>
          <CopyField
            value={`claude mcp add --transport http octadash ${mcpUrl} --header "Authorization: Bearer ${token}"`}
            copyLabel={labels.copy}
            copiedLabel={labels.copied}
            multiline
          />
        </div>
      )}
    </div>
  )
}

export function RevokeApiToken({
  id,
  labels,
}: {
  id: string
  labels: { trigger: string; title: string; body: string; cancel: string }
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
          {labels.trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.title}</AlertDialogTitle>
          <AlertDialogDescription>{labels.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <ActionForm action={revokeApiTokenAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={id} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
            <SubmitButton variant="destructive">{labels.trigger}</SubmitButton>
          </div>
        </ActionForm>
      </AlertDialogContent>
    </AlertDialog>
  )
}
