import { listProjects } from '@octadash/db'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { Logo } from '@/components/logo'
import { NavTabs } from '@/components/nav-tabs'
import { OrgSwitcher } from '@/components/org-switcher'
import { UserMenu } from '@/components/user-menu'
import { services } from '@/server/context'
import { requireOrg } from '@/server/session'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { org, orgs, user } = await requireOrg()
  const [projects, t] = await Promise.all([
    listProjects(services().db, org.id),
    getTranslations('common'),
  ])
  const tabs = [
    { href: '/all', label: t('allProducts') },
    ...projects.map((p) => ({ href: `/p/${p.slug}`, label: p.name })),
  ]

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3">
          <Link href="/all" className="flex items-center gap-2">
            <Logo size={24} />
            <span className="font-display text-lg font-semibold tracking-tight">Octadash</span>
          </Link>
          <span className="text-muted-foreground/50" aria-hidden>
            /
          </span>
          {orgs.length > 1 ? (
            <OrgSwitcher
              key={org.id}
              current={{ id: org.id, name: org.name }}
              orgs={orgs.map((o) => ({ id: o.id, name: o.name }))}
              label={t('organization')}
            />
          ) : (
            <span className="text-sm text-muted-foreground">{org.name}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <LocaleSwitcher />
            <UserMenu
              name={user.name}
              email={user.email}
              labels={{ account: t('account'), members: t('members'), signOut: t('signOut') }}
            />
          </div>
        </div>
        <div className="mx-auto w-full max-w-6xl px-4">
          <NavTabs tabs={tabs} newLabel={t('newProduct')} />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
        {children}
      </main>
    </div>
  )
}
