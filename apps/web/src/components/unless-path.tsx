'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/** Hides its children on one page, for links that would point to the page itself. */
export function UnlessPath({ path, children }: { path: string; children: ReactNode }) {
  return usePathname() === path ? null : children
}
