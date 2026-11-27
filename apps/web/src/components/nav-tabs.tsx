'use client'

import { PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

export interface Tab {
  href: string
  label: string
}

/** Product tabs: "All" first, then one per product, then "+". */
export function NavTabs({ tabs, newLabel }: { tabs: Tab[]; newLabel: string }) {
  const pathname = usePathname()
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Products">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors',
              active
                ? 'border-brand font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </Link>
        )
      })}
      <Link
        href="/products/new"
        title={newLabel}
        aria-label={newLabel}
        className="flex shrink-0 items-center border-b-2 border-transparent px-3 py-2.5 text-muted-foreground hover:text-brand"
      >
        <PlusIcon className="size-4" />
      </Link>
    </nav>
  )
}
