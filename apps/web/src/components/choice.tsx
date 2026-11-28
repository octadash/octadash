'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from './ui/badge'

export function OptionGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  )
}

/**
 * One choice of a single-choice group: as wide as its content; the chosen one
 * has a thicker magenta border and a filled background (no check mark, which
 * is for multiple choice). A native radio underneath keeps the keyboard and
 * screen reader behavior.
 */
export function Option({
  name,
  checked,
  disabled,
  badge,
  onChange,
  value,
  children,
}: {
  name: string
  checked: boolean
  disabled?: boolean
  badge?: string
  onChange: () => void
  /** Sent with the form when chosen. */
  value?: string
  children: ReactNode
}) {
  return (
    <label
      className={cn(
        'relative flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50',
        checked
          ? 'border-2 border-brand bg-brand/10 px-[13px] py-[7px]'
          : 'border border-input hover:bg-secondary/60',
        disabled ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
      />
      {children}
      {badge && (
        <Badge variant="secondary" className="absolute -top-2 -right-2 px-1.5 py-0 text-[10px]">
          {badge}
        </Badge>
      )}
    </label>
  )
}
