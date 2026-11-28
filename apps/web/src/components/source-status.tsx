import { CircleIcon, DiamondIcon } from 'lucide-react'
import { duration } from '@/lib/duration'

/** Past this, a source that sent before reads "Nothing for …" instead of "Receiving". */
export const QUIET_AFTER_MS = 86_400_000

/**
 * When a source last sent data, as words with a shape: a filled dot while it
 * sends, a diamond once it went quiet, an empty circle when it never sent.
 */
export function SourceStatus({
  last,
  unknown,
  locale,
  relative,
  labels,
  now = Date.now(),
}: {
  last: Date | null
  /** ClickHouse did not answer: nothing is said. */
  unknown: boolean
  locale: string
  relative: (date: Date) => string
  labels: { receiving: (time: string) => string; quiet: (time: string) => string; never: string }
  now?: number
}) {
  if (unknown) return <span className="text-xs text-muted-foreground">—</span>
  if (!last) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleIcon aria-hidden className="size-2.5 shrink-0" />
        {labels.never}
      </span>
    )
  }
  const age = now - last.getTime()
  if (age > QUIET_AFTER_MS) {
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <DiamondIcon aria-hidden className="size-2.5 shrink-0 fill-warn text-warn" />
        {labels.quiet(duration(locale, age))}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <CircleIcon aria-hidden className="size-2.5 shrink-0 fill-ok text-ok" />
      {labels.receiving(relative(last))}
    </span>
  )
}
