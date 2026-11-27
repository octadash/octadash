import type { Status } from '@octadash/diagnosis'
import { CircleCheckIcon, CircleDashedIcon, CircleHelpIcon, CircleXIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const icons = {
  ok: { Icon: CircleCheckIcon, className: 'text-ok' },
  partial: { Icon: CircleDashedIcon, className: 'text-warn' },
  missing: { Icon: CircleXIcon, className: 'text-destructive' },
  unknown: { Icon: CircleHelpIcon, className: 'text-muted-foreground' },
} as const

/** One icon per status, so the ladder reads at a glance; the label is for screen readers. */
export function StatusIcon({
  status,
  label,
  className,
}: {
  status: Status
  /** Leave out when a text label is already next to the icon. */
  label?: string
  className?: string
}) {
  const { Icon, className: color } = icons[status]
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }
  return <Icon {...a11y} className={cn('size-4 shrink-0', color, className)} />
}
