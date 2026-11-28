import type { ProductStatus } from '@/lib/monitors'
import { cn } from '@/lib/utils'

const COLORS: Record<ProductStatus | 'paused', string> = {
  up: 'bg-ok',
  down: 'bg-error',
  unknown: 'bg-warn',
  none: 'bg-muted-foreground/50',
  paused: 'bg-muted-foreground/50',
}

/**
 * Green up, orange down, amber waiting, gray without monitors or paused.
 * Decorative: the state is always written next to it.
 */
export function StatusDot({
  status,
  className,
}: {
  status: ProductStatus | 'paused'
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', COLORS[status], className)}
    />
  )
}
