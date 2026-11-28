'use client'

import { SearchIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, useState } from 'react'
import { cn } from '@/lib/utils'

export interface SettingsSection {
  title: string
  /** "owner": shown next to the title for sections only owners see. */
  note?: string
  items: { href: string; label: string; keywords?: string }[]
}

/**
 * The menu inside Settings, grouped (Organization, Alerts, This install, You)
 * with a search that filters it as you type.
 */
export function SettingsNav({
  sections,
  labels,
  footer,
}: {
  sections: SettingsSection[]
  labels: { nav: string; search: string; none: string }
  footer: ReactNode
}) {
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLocaleLowerCase()
  const shown = sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          !needle ||
          `${section.title} ${item.label} ${item.keywords ?? ''}`
            .toLocaleLowerCase()
            .includes(needle),
      ),
    }))
    .filter((section) => section.items.length > 0)

  return (
    <nav aria-label={labels.nav} className="flex flex-col gap-4 md:w-56 md:shrink-0">
      <label className="flex h-9 items-center gap-2 rounded-lg border border-border px-2.5 text-sm text-muted-foreground focus-within:border-ring">
        <SearchIcon className="size-4" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.search}
          aria-label={labels.search}
          className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
      {shown.length === 0 && <p className="px-2.5 text-sm text-muted-foreground">{labels.none}</p>}
      {shown.map((section) => (
        <div key={section.title} className="flex flex-col gap-0.5">
          <h2 className="px-2.5 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {section.title}
            {section.note && (
              <span className="font-normal tracking-normal normal-case"> · {section.note}</span>
            )}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex h-8 items-center rounded-lg border-l-2 px-2.5 text-sm',
                      active
                        ? 'border-brand bg-secondary font-medium text-foreground'
                        : 'border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
      <div className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
        {footer}
      </div>
    </nav>
  )
}
