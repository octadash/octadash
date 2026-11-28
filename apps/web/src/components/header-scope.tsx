'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/**
 * The top bar's left side: the product picker, except in Settings, which are
 * the organization's and say so ("Acme / Settings").
 */
export function HeaderScope({
  children,
  labels,
}: {
  children: ReactNode
  labels: { org: string; settings: string; trail: string }
}) {
  const pathname = usePathname()
  if (pathname !== '/settings' && !pathname.startsWith('/settings/')) return children
  return (
    <nav aria-label={labels.trail}>
      <ol className="flex items-center gap-2 text-sm">
        <li className="text-muted-foreground">{labels.org}</li>
        <li aria-hidden className="text-muted-foreground">
          /
        </li>
        <li aria-current="page" className="font-medium">
          {labels.settings}
        </li>
      </ol>
    </nav>
  )
}
