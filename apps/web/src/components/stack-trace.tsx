'use client'

import type { ErrorException, ErrorFrame } from '@octadash/db'
import { ChevronRightIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '@/lib/utils'
import { Label } from './ui/label'
import { Switch } from './ui/switch'

export interface StackLabels {
  title: string
  ownOnly: string
  at: string
  atLine: string
  hidden: string
  showAll: string
  causedBy: string
  noFrames: string
}

function where(frame: ErrorFrame) {
  return frame.filename || frame.module || '?'
}

function Frame({ frame, open, labels }: { frame: ErrorFrame; open: boolean; labels: StackLabels }) {
  const hasCode = frame.context_line !== undefined
  const head = (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span className="font-mono text-sm font-medium break-all">{where(frame)}</span>
      <span className="text-xs text-muted-foreground">
        {[
          frame.function ? labels.at.replace('{fn}', frame.function) : '',
          frame.lineno !== undefined ? labels.atLine.replace('{line}', String(frame.lineno)) : '',
        ]
          .filter(Boolean)
          .join(' ')}
      </span>
    </span>
  )
  if (!hasCode) {
    return <li className="rounded-md border border-border px-3 py-2">{head}</li>
  }
  const first = (frame.lineno ?? 0) - (frame.pre_context?.length ?? 0)
  const lines = [
    ...(frame.pre_context ?? []),
    frame.context_line ?? '',
    ...(frame.post_context ?? []),
  ]
  return (
    <li className="rounded-md border border-border">
      <details open={open} className="group">
        <summary className="flex cursor-pointer items-center gap-2 px-3 py-2">
          <ChevronRightIcon
            aria-hidden
            className="size-4 shrink-0 transition-transform group-open:rotate-90"
          />
          {head}
        </summary>
        <pre
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take the keyboard.
          tabIndex={0}
          className="overflow-x-auto border-t border-border bg-muted/40 py-2 font-mono text-xs"
        >
          {lines.map((line, i) => {
            const number = first + i
            const current = number === frame.lineno
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: source lines in order.
                key={i}
                className={cn('flex gap-3 px-3', current && 'bg-error/15 font-semibold')}
                aria-current={current ? 'true' : undefined}
              >
                <span className="w-8 shrink-0 text-right text-muted-foreground select-none">
                  {number}
                </span>
                <span className="whitespace-pre">{line}</span>
              </div>
            )
          })}
        </pre>
      </details>
    </li>
  )
}

/**
 * "Where it happened": the thrown exception first, its causes after, each
 * with its frames innermost first. Only the app's own frames by default; the
 * library frames are counted and shown with one switch.
 */
export function StackTrace({
  exceptions,
  labels,
}: {
  exceptions: ErrorException[]
  labels: StackLabels
}) {
  const id = useId()
  const [ownOnly, setOwnOnly] = useState(true)
  const anyOwn = exceptions.some((e) => e.frames.some((f) => f.in_app))
  const filter = ownOnly && anyOwn
  const ordered = [...exceptions].reverse()

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{labels.title}</h2>
        {anyOwn && (
          <div className="flex items-center gap-2">
            <Label htmlFor={`${id}-own`} className="text-sm font-normal">
              {labels.ownOnly}
            </Label>
            <Switch id={`${id}-own`} checked={ownOnly} onCheckedChange={setOwnOnly} />
          </div>
        )}
      </div>
      {ordered.map((exception, n) => {
        const frames = [...exception.frames].reverse()
        const shown = filter ? frames.filter((f) => f.in_app) : frames
        const hidden = frames.length - shown.length
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: the chain in order.
            key={n}
            className="flex flex-col gap-2"
          >
            {n > 0 && (
              <p className="text-sm">
                <span className="text-muted-foreground">{labels.causedBy} </span>
                <span className="font-medium">
                  {exception.type}
                  {exception.value ? `: ${exception.value}` : ''}
                </span>
              </p>
            )}
            {shown.length === 0 ? (
              <p className="text-sm text-muted-foreground">{labels.noFrames}</p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {shown.map((frame, i) => (
                  <Frame
                    // biome-ignore lint/suspicious/noArrayIndexKey: frames in order.
                    key={i}
                    frame={frame}
                    open={i === 0}
                    labels={labels}
                  />
                ))}
              </ol>
            )}
            {hidden > 0 && (
              <p className="text-xs text-muted-foreground">
                {labels.hidden.replace('{count}', String(hidden))}{' '}
                <button
                  type="button"
                  className="text-brand underline underline-offset-4"
                  onClick={() => setOwnOnly(false)}
                >
                  {labels.showAll}
                </button>
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
