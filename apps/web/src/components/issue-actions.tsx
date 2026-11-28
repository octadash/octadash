'use client'

import { MoreHorizontalIcon } from 'lucide-react'
import Link from 'next/link'
import { type ComponentProps, startTransition, useState } from 'react'
import { type IgnoreChoice, issueAction } from '@/actions/issues'
import { ActionForm } from './action-form'
import { Option, OptionGroup } from './choice'
import { InfoTip } from './info-tip'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'

type Kind = 'resolve' | 'resolveInNextRelease' | 'reopen' | 'take' | 'leave'

/** One action on an issue as a button: Resolve, I'm on it, Reopen... */
export function IssueButton({
  issueId,
  kind,
  label,
  variant,
  size,
  name,
}: {
  issueId: string
  kind: Kind
  label: string
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
  /** For screen readers when the label repeats on every row: the issue's title. */
  name?: string
}) {
  return (
    <ActionForm action={issueAction} className="contents">
      <input type="hidden" name="issue" value={issueId} />
      <input type="hidden" name="kind" value={kind} />
      <SubmitButton variant={variant} size={size}>
        {label}
        {name && <span className="sr-only">, {name}</span>}
      </SubmitButton>
    </ActionForm>
  )
}

export interface IgnoreLabels {
  trigger: string
  title: string
  body: string
  info: string
  infoLabel: string
  legend: string
  choices: Record<IgnoreChoice, string>
  cancel: string
  confirm: string
}

/** "Ignore": hides the issue until a condition is met; it then comes back as Regressed. */
export function IgnoreDialog({
  issueId,
  labels,
  open,
  onOpenChange,
  trigger = true,
}: {
  issueId: string
  labels: IgnoreLabels
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** False when a menu opens the dialog. */
  trigger?: boolean
}) {
  const [own, setOwn] = useState(false)
  const [choice, setChoice] = useState<IgnoreChoice>('events')
  const isOpen = open ?? own
  const setOpen = onOpenChange ?? setOwn
  return (
    <>
      {trigger && (
        <span className="flex items-center gap-1">
          <Button type="button" variant="outline" onClick={() => setOpen(true)}>
            {labels.trigger}
          </Button>
          <InfoTip label={labels.infoLabel} title={labels.title}>
            {labels.info}
          </InfoTip>
        </span>
      )}
      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.title}</DialogTitle>
            <DialogDescription>{labels.body}</DialogDescription>
          </DialogHeader>
          <ActionForm action={issueAction} onDone={() => setOpen(false)}>
            <input type="hidden" name="issue" value={issueId} />
            <input type="hidden" name="kind" value="ignore" />
            <OptionGroup legend={labels.legend}>
              {(['events', 'people', 'day', 'never'] as const).map((value) => (
                <Option
                  key={value}
                  name="until"
                  value={value}
                  checked={choice === value}
                  onChange={() => setChoice(value)}
                >
                  {labels.choices[value]}
                </Option>
              ))}
            </OptionGroup>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {labels.cancel}
                </Button>
              </DialogClose>
              <SubmitButton>{labels.confirm}</SubmitButton>
            </div>
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** The "…" of a row: the other actions and the issue's page. */
export function IssueMenu({
  issueId,
  href,
  name,
  labels,
  ignore,
}: {
  issueId: string
  href: string
  /** The issue's title, for the menu button's name. */
  name: string
  labels: { more: string; open: string; nextRelease: string; ignore: string }
  ignore: IgnoreLabels
}) {
  const [ignoring, setIgnoring] = useState(false)
  const run = (kind: Kind) => {
    const data = new FormData()
    data.set('issue', issueId)
    data.set('kind', kind)
    startTransition(async () => {
      await issueAction(undefined, data)
    })
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`${labels.more}: ${name}`}>
            <MoreHorizontalIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={href}>{labels.open}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run('resolveInNextRelease')}>
            {labels.nextRelease}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setIgnoring(true)}>{labels.ignore}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IgnoreDialog
        issueId={issueId}
        labels={ignore}
        open={ignoring}
        onOpenChange={setIgnoring}
        trigger={false}
      />
    </>
  )
}
