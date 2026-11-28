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
import { KeyRoundIcon, PlusIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { createApiTokenAction, revokeApiTokenAction } from '@/actions/api-tokens'
import { ActionForm } from './action-form'
import { CopyField } from './copy-field'
import { Field } from './field'
import { InfoTip } from './info-tip'
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
import { NativeSelect, NativeSelectOption } from './ui/native-select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'

export interface NewTokenLabels {
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
  token: string
  once: string
  command: string
  copy: string
  copied: string
}

const ON = 'data-[state=on]:border-brand data-[state=on]:text-brand'

/**
 * "New token": a name, what it may touch (a preset, then item by item: no
 * access, read or write, and delete apart), then the token shown once with
 * the command that adds Octadash to Claude Code.
 */
export function NewApiToken({ mcpUrl, labels }: { mcpUrl: string; labels: NewTokenLabels }) {
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

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (empty) return
          start(async () => {
            const { token } = await createApiTokenAction(name, scopes)
            setToken(token)
            setName('')
            setScopes(cleanScopes(TOKEN_PRESETS.read))
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
                        onChange={(event) => setLevel(resource, event.target.value as TokenLevel)}
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
        <Button type="submit" disabled={pending || empty} className="self-start">
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
