'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

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
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors ${
              active
                ? 'border-accent font-medium text-text'
                : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
      <Link
        href="/products/new"
        title={newLabel}
        aria-label={newLabel}
        className="shrink-0 border-b-2 border-transparent px-3 py-2.5 text-sm text-muted hover:text-accent"
      >
        +
      </Link>
    </nav>
  )
}
