'use client'

import { EllipsisIcon, SearchIcon } from 'lucide-react'
import { useLocale } from 'next-intl'
import { use, useEffect, useRef, useState } from 'react'
import { changeRoleAction, removeMemberAction } from '@/actions/members'
import { ActionForm, FormStateContext } from './action-form'
import { InfoTip } from './info-tip'
import { SubmitButton } from './submit-button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

export type Role = 'owner' | 'admin' | 'member'

export interface MemberLine {
  id: string
  name: string
  email: string
  role: Role
  you: boolean
  /** "Now", "2 h ago", "Never". */
  seen: string
}

export interface MembersLabels {
  search: string
  /** "# member" and "# members", with # for the number shown. */
  count: { one: string; other: string }
  name: string
  email: string
  role: string
  roleInfo: { label: string; title: string; owner: string; admin: string; member: string }
  lastSeen: string
  you: string
  roles: Record<Role, string>
  actions: string
  remove: string
  removeTitle: string
  removeBody: string
  cancel: string
  nobody: string
}

/**
 * Settings › Members: one row per person with the role as a Select that saves
 * on change, when they last opened the organization, and removing someone.
 */
export function MembersTable({
  members,
  canEdit,
  canTouchOwners,
  labels,
}: {
  members: MemberLine[]
  canEdit: boolean
  /** Owners give and take the owner role; admins only manage admins and members. */
  canTouchOwners: boolean
  labels: MembersLabels
}) {
  const locale = useLocale()
  const [query, setQuery] = useState('')
  const [removing, setRemoving] = useState<MemberLine | null>(null)
  const q = query.trim().toLowerCase()
  const shown = q
    ? members.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
    : members

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.search}
            aria-label={labels.search}
            className="pl-8"
          />
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          {(new Intl.PluralRules(locale).select(shown.length) === 'one'
            ? labels.count.one
            : labels.count.other
          ).replace('#', String(shown.length))}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">{labels.name}</TableHead>
              <TableHead>{labels.email}</TableHead>
              <TableHead>
                <span className="flex items-center gap-1">
                  {labels.role}
                  <InfoTip label={labels.roleInfo.label} title={labels.roleInfo.title}>
                    <span className="flex flex-col gap-1.5">
                      <span>
                        <strong className="text-foreground">{labels.roles.owner}</strong>:{' '}
                        {labels.roleInfo.owner}
                      </span>
                      <span>
                        <strong className="text-foreground">{labels.roles.admin}</strong>:{' '}
                        {labels.roleInfo.admin}
                      </span>
                      <span>
                        <strong className="text-foreground">{labels.roles.member}</strong>:{' '}
                        {labels.roleInfo.member}
                      </span>
                    </span>
                  </InfoTip>
                </span>
              </TableHead>
              <TableHead>{labels.lastSeen}</TableHead>
              {canEdit && (
                <TableHead className="w-12 pr-4">
                  <span className="sr-only">{labels.actions}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={canEdit ? 5 : 4}
                  className="py-6 text-center text-muted-foreground"
                >
                  {labels.nobody}
                </TableCell>
              </TableRow>
            )}
            {shown.map((m) => {
              const locked = !canEdit || (m.role === 'owner' && !canTouchOwners)
              return (
                <TableRow key={m.id}>
                  <TableCell className="pl-4">
                    <span className="flex items-center gap-2.5">
                      <span
                        aria-hidden
                        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold uppercase"
                      >
                        {m.name.trim().charAt(0) || '?'}
                      </span>
                      <span className="font-medium">{m.name}</span>
                      {m.you && (
                        <span className="text-xs text-muted-foreground">({labels.you})</span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.email}</TableCell>
                  <TableCell>
                    {locked ? (
                      <Badge variant={m.role === 'owner' ? 'brand' : 'secondary'}>
                        {labels.roles[m.role]}
                      </Badge>
                    ) : (
                      <RoleForm
                        member={m}
                        roles={canTouchOwners ? ['owner', 'admin', 'member'] : ['admin', 'member']}
                        labels={labels}
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.seen}</TableCell>
                  {canEdit && (
                    <TableCell className="pr-4 text-right">
                      {!m.you && !locked && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`${labels.actions}: ${m.name}`}
                            >
                              <EllipsisIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(m)}>
                              {labels.remove}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {labels.removeTitle.replace('{name}', removing?.name ?? '')}
            </AlertDialogTitle>
            <AlertDialogDescription>{labels.removeBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <ActionForm action={removeMemberAction} onDone={() => setRemoving(null)}>
            <input type="hidden" name="memberId" value={removing?.id ?? ''} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialogCancel>{labels.cancel}</AlertDialogCancel>
              <SubmitButton variant="destructive">{labels.remove}</SubmitButton>
            </div>
          </ActionForm>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** The role Select of one row; it saves as soon as a role is picked. */
function RoleForm({
  member,
  roles,
  labels,
}: {
  member: MemberLine
  roles: Role[]
  labels: MembersLabels
}) {
  const [role, setRole] = useState(member.role)
  const form = useRef<HTMLFormElement>(null)
  return (
    <ActionForm action={changeRoleAction} className="flex flex-col gap-1">
      <input type="hidden" name="memberId" value={member.id} />
      <input type="hidden" name="role" value={role} />
      <UndoOnError onError={() => setRole(member.role)} />
      <Select
        value={role}
        onValueChange={(value) => {
          setRole(value as Role)
          // Submit after React writes the new hidden value.
          setTimeout(() => form.current?.requestSubmit())
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-28"
          aria-label={`${labels.role}: ${member.name}`}
          ref={(node) => {
            form.current = node?.closest('form') ?? null
          }}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {roles.map((r) => (
            <SelectItem key={r} value={r}>
              {labels.roles[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ActionForm>
  )
}

/** Puts the Select back when the server refused the change; the form shows why. */
function UndoOnError({ onError }: { onError: () => void }) {
  const error = use(FormStateContext)?.error
  const undo = useRef(onError)
  undo.current = onError
  useEffect(() => {
    if (error) undo.current()
  }, [error])
  return null
}
