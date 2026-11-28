'use client'

import { InfoIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * The "i" next to a setting: a Popover, not a Tooltip, so it opens on click,
 * Enter and touch, and a screen reader reaches its text.
 */
export function InfoTip({
  label,
  title,
  children,
}: {
  /** What the button says to a screen reader: "About Password". */
  label: string
  title?: string
  children: ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label={label}
        className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <InfoIcon className="size-3.5" aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm leading-relaxed">
        {title && <p className="mb-1 font-semibold">{title}</p>}
        <div className="text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  )
}
