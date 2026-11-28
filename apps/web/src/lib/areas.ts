import type { AreaId } from '@octadash/db'
import {
  ActivityIcon,
  GlobeIcon,
  LayoutGridIcon,
  type LucideIcon,
  ReceiptIcon,
  TerminalIcon,
  TriangleAlertIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react'

/**
 * The areas in menu order, with their icons. Kept here (not imported from
 * @octadash/db at runtime) because client components use it; a test keeps the
 * list equal to the database's.
 */
export const AREA_ITEMS = [
  { id: 'uptime', icon: ActivityIcon },
  { id: 'traffic', icon: GlobeIcon },
  { id: 'usage', icon: UsersIcon },
  { id: 'errors', icon: TriangleAlertIcon },
  { id: 'money', icon: WalletIcon },
  { id: 'costs', icon: ReceiptIcon },
  { id: 'logs', icon: TerminalIcon },
] as const satisfies readonly { id: AreaId; icon: LucideIcon }[]

export const OverviewIcon = LayoutGridIcon

const AREA_IDS: readonly string[] = AREA_ITEMS.map((item) => item.id)

/** Where the visitor is: one product (`/p/<slug>`) or every product (`/all`). */
export interface Scope {
  base: string
  slug: string | null
}

export function scopeOf(pathname: string): Scope {
  const match = /^\/p\/([^/]+)/.exec(pathname)
  if (match?.[1]) return { base: `/p/${match[1]}`, slug: decodeURIComponent(match[1]) }
  return { base: '/all', slug: null }
}

/** The area open in the path, if any, so switching products keeps it. */
export function areaOf(pathname: string): string | null {
  const segment = pathname.split('/').filter(Boolean)[pathname.startsWith('/p/') ? 2 : 1]
  return segment && AREA_IDS.includes(segment) ? segment : null
}
