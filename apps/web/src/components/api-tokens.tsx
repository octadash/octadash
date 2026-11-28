'use client'

import {
  cleanScopes,
  isEmptyScopes,
  presetOf,
  TOKEN_LEVELS,
  TOKEN_PRESETS,
  TOKEN_RESOURCES,
  type TokenLevel,
  type TokenPreset,
  type TokenResource,
  type TokenScopes,
} from '@octadash/db/token-scopes'
import { PlusIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { createApiTokenAction, revokeApiTokenAction } from '@/actions/api-tokens'
import { ActionForm } from './action-form'
import { Field } from './field'
import { InfoTip } from './info-tip'
import { McpConnect } from './mcp-connect'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

export interface NewTokenLabels {
  /** The button and the dialog's title: "New token". */
  title: string
  intro: string
  name: string
  nameHint: string
  namePlaceholder: string
  access: string
  accessHint: string
  presets: Record<TokenPreset, string>
  custom: string
  resource: string
  level: string
  levels: Record<TokenLevel, string>
  delete: string
  deleteHint: string
  resources: Record<TokenResource, string>
  create: string
  nothing: string
  once: string
  cancel: string
  done: string
}

const ON = 'data-[state=on]:border-brand data-[state=on]:text-brand'

/**
 * "New token" opens a dialog: a name, what it may touch (a preset, then item
 * by item: no access, read or write, and delete apart), then the token shown
 * once with the command that adds Octadash to Claude Code. Closing it forgets
 * the token.
 */
export function NewApiToken({ mcpUrl, labels }: { mcpUrl: string; labels: NewTokenLabels }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<TokenScopes>(cleanScopes(TOKEN_PRESETS.read))
  const [token, setToken] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const preset = presetOf(scopes)
  const empty = isEmptyScopes(scopes)

  const setLevel = (resource: TokenResource, level: TokenLevel) =>
    setScopes((current) =>
      cleanScopes({ ...current, levels: { ...current.levels, [resource]: level } }),
    )
  const setDelete = (resource: TokenResource, on: boolean) =>
    setScopes((current) =>
      cleanScopes({
        ...current,
        delete: on ? [...current.delete, resource] : current.delete.filter((r) => r !== resource),
      }),
    )
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setToken(null)
      setName('')
      setScopes(cleanScopes(TOKEN_PRESETS.read))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" aria-hidden />
          {labels.title}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.intro}</DialogDescription>
        </DialogHeader>
        {token ? (
          <div role="status" className="flex flex-col gap-5">
            <p className="text-sm font-medium text-ok">{labels.once}</p>
            <McpConnect mcpUrl={mcpUrl} token={token} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button>{labels.done}</Button>
              </DialogClose>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (empty) return
              start(async () => {
                const { token } = await createApiTokenAction(name, scopes)
                setToken(token)
              })
            }}
          >
            <Field label={labels.name} hint={labels.nameHint}>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                placeholder={labels.namePlaceholder}
                required
                autoFocus
              />
            </Field>

            <fieldset className="flex flex-col gap-3">
              <legend className="text-sm font-medium">{labels.access}</legend>
              <p className="text-xs text-muted-foreground">{labels.accessHint}</p>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={preset ?? ''}
                onValueChange={(value) =>
                  value && setScopes(cleanScopes(TOKEN_PRESETS[value as TokenPreset]))
                }
                aria-label={labels.access}
              >
                {(Object.keys(TOKEN_PRESETS) as TokenPreset[]).map((p) => (
                  <ToggleGroupItem key={p} className={ON} value={p}>
                    {labels.presets[p]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {!preset && <p className="text-xs text-muted-foreground">{labels.custom}</p>}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{labels.resource}</TableHead>
                    <TableHead>{labels.level}</TableHead>
                    <TableHead>
                      <span className="flex items-center gap-1">
                        {labels.delete}
                        <InfoTip label={labels.delete} title={labels.delete}>
                          {labels.deleteHint}
                        </InfoTip>
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {TOKEN_RESOURCES.map((resource) => {
                    const level = scopes.levels[resource] ?? 'none'
                    const id = `api-token-${resource}`
                    return (
                      <TableRow key={resource}>
                        <TableCell>
                          <label htmlFor={id} className="text-sm">
                            {labels.resources[resource]}
                          </label>
                        </TableCell>
                        <TableCell>
                          <NativeSelect
                            id={id}
                            size="sm"
                            value={level}
                            onChange={(event) =>
                              setLevel(resource, event.target.value as TokenLevel)
                            }
                          >
                            {TOKEN_LEVELS.map((l) => (
                              <NativeSelectOption key={l} value={l}>
                                {labels.levels[l]}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </TableCell>
                        <TableCell>
                          <Checkbox
                            checked={scopes.delete.includes(resource)}
                            disabled={level !== 'write'}
                            onCheckedChange={(on) => setDelete(resource, on === true)}
                            aria-label={`${labels.delete}: ${labels.resources[resource]}`}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </fieldset>

            {empty && <p className="text-sm text-warn">{labels.nothing}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {labels.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={pending || empty}>
                {labels.create}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
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
