'use client'

import { ArrowUpCircleIcon, SettingsIcon, SlidersVerticalIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AREA_ITEMS, OverviewIcon, scopeOf } from '@/lib/areas'
import { cn } from '@/lib/utils'
import { Logo } from './logo'
import { Separator } from './ui/separator'

export interface SidebarLabels {
  nav: string
  overview: string
  /** "Product settings" and "Group settings": below the areas, follows the picker. */
  productSettings: string
  groupSettings: string
  /** "Octadash settings": always at the bottom of the menu. */
  octadashSettings: string
  areas: Record<(typeof AREA_ITEMS)[number]['id'], string>
}

/** A newer Octadash exists: shown to owners and admins above Settings. */
export interface SidebarUpdate {
  label: string
  detail: string
  href: string
}

/**
 * The menu is the area; the product picker in the header is the product. The
 * same item opens the area for the chosen product or for every product.
 */
export function AppSidebar({
  labels,
  update,
  version,
}: {
  labels: SidebarLabels
  update?: SidebarUpdate | null
  /** The running version, as `versionLabel` writes it: "v1.4.0", "edge · 4752944". */
  version: { label: string; title: string }
}) {
  const pathname = usePathname()
  const scope = scopeOf(pathname)
  // Three settings: Octadash's own, always at the bottom; the product's or the
  // group's below the areas, following the picker (none for every product).
  const settings =
    scope.kind === 'all'
      ? null
      : {
          href: `${scope.base}/settings`,
          label: scope.kind === 'product' ? labels.productSettings : labels.groupSettings,
        }
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
    <aside className="border-b border-border bg-card md:sticky md:top-0 md:flex md:h-dvh md:w-68 md:shrink-0 md:flex-col md:border-r md:border-b-0">
      <Link href="/all" className="hidden items-center gap-2.5 px-5 pt-5 pb-4 md:flex">
        <Logo size={26} />
        <span className="flex min-w-0 flex-col">
          <span className="font-display text-xl leading-tight font-semibold tracking-tight">
            Octadash
          </span>
          <span title={version.title} className="truncate text-xs text-muted-foreground">
            {version.label}
          </span>
        </span>
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
        {settings && (
          <>
            <Separator orientation="vertical" className="mx-1 h-6 self-center md:hidden" />
            <Separator className="my-2 hidden md:block" />
            <SidebarLink
              href={settings.href}
              label={settings.label}
              icon={SlidersVerticalIcon}
              active={isWithin(pathname, settings.href)}
            />
          </>
        )}
        <div className="hidden md:block md:flex-1" />
        {update && (
          <a
            href={update.href}
            target="_blank"
            rel="noreferrer"
            className="hidden shrink-0 flex-col gap-0.5 rounded-lg border border-brand/40 bg-brand/5 px-3 py-2 text-sm transition-colors hover:bg-brand/10 md:flex"
          >
            <span className="flex items-center gap-2 font-medium">
              <ArrowUpCircleIcon aria-hidden className="size-4 text-brand" />
              {update.label}
            </span>
            <span className="text-xs text-muted-foreground">{update.detail}</span>
          </a>
        )}
        <SidebarLink
          href="/settings/general"
          label={labels.octadashSettings}
          icon={SettingsIcon}
          active={isWithin(pathname, '/settings')}
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
      <Icon className={cn('size-4 shrink-0', active && 'text-brand')} />
      <span className="truncate">{label}</span>
    </Link>
  )
}
