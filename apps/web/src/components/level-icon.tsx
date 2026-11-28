import { CircleIcon, DiamondIcon, TriangleIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export type Level = 'emergency' | 'signal' | 'off'

/**
 * The symbol next to each alert level, so a level never reads by color alone.
 * Kept out of client files so server pages can render it too.
 */
export const LEVEL_ICON: Record<Level, ReactNode> = {
  emergency: <TriangleIcon className="size-3 fill-current text-error" aria-hidden />,
  signal: <DiamondIcon className="size-3 fill-current text-warn" aria-hidden />,
  off: <CircleIcon className="size-3 text-muted-foreground" aria-hidden />,
}
