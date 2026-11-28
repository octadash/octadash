'use client'

import { SlidersVerticalIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AREA_ITEMS, OverviewIcon, scopeOf } from '@/lib/areas'
import { cn } from '@/lib/utils'
import { Logo } from './logo'

export interface SidebarLabels {
  nav: string
  overview: string
  settings: string
  areas: Record<(typeof AREA_ITEMS)[number]['id'], string>
}

/**
 * The menu is the area; the product picker in the header is the product. The
 * same item opens the area for the chosen product or for every product.
 */
export function AppSidebar({ labels }: { labels: SidebarLabels }) {
  const pathname = usePathname()
  const scope = scopeOf(pathname)
  const settingsHref = scope.slug ? `${scope.base}/settings` : '/settings/members'
  const items = [
    { href: scope.base, label: labels.overview, icon: OverviewIcon, exact: true },
    ...AREA_ITEMS.map((area) => ({
      href: `${scope.base}/${area.id}`,
      label: labels.areas[area.id],
      icon: area.icon,
      exact: false,
    })),
  ]

  return (
    <aside className="border-b border-border bg-card md:sticky md:top-0 md:flex md:h-dvh md:w-56 md:shrink-0 md:flex-col md:border-r md:border-b-0">
      <Link href="/all" className="hidden items-center gap-2.5 px-5 pt-5 pb-4 md:flex">
        <Logo size={26} />
        <span className="font-display text-xl font-semibold tracking-tight">Octadash</span>
      </Link>
      <nav
        aria-label={labels.nav}
        className="flex gap-1 overflow-x-auto px-3 py-2 md:flex-1 md:flex-col md:overflow-visible md:py-0"
      >
        {items.map((item) => (
          <SidebarLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={item.exact ? pathname === item.href : isWithin(pathname, item.href)}
          />
        ))}
        <div className="hidden md:block md:flex-1" />
        <SidebarLink
          href={settingsHref}
          label={labels.settings}
          icon={SlidersVerticalIcon}
          active={isWithin(pathname, settingsHref) || pathname.startsWith('/settings/')}
          className="md:mb-4"
        />
      </nav>
    </aside>
  )
}

function isWithin(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

function SidebarLink({
  href,
  label,
  icon: Icon,
  active,
  className,
}: {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  className?: string
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-sm whitespace-nowrap transition-colors',
        active
          ? 'bg-secondary font-medium text-foreground'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
        className,
      )}
    >
      <Icon className={cn('size-4', active && 'text-brand')} />
      {label}
    </Link>
  )
}
