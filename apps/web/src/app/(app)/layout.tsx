import { listProjects } from '@octadash/db'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { signOutAction, switchOrgAction } from '@/actions/auth'
import { AutoSubmitSelect } from '@/components/auto-submit-select'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { NavTabs } from '@/components/nav-tabs'
import { Logo } from '@/components/ui'
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
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3">
          <Link href="/all" className="flex items-center gap-2">
            <Logo size={24} />
            <span className="font-display text-lg font-semibold tracking-tight">Octadash</span>
          </Link>
          {orgs.length > 1 ? (
            <form action={switchOrgAction}>
              <AutoSubmitSelect
                name="organizationId"
                defaultValue={org.id}
                label={t('organization')}
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </AutoSubmitSelect>
            </form>
          ) : (
            <span className="text-sm text-muted">{org.name}</span>
          )}
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link href="/settings/members" className="text-muted hover:text-text">
              {t('members')}
            </Link>
            <LocaleSwitcher />
            <form action={signOutAction}>
              <button type="submit" className="text-muted hover:text-text" title={user.email}>
                {t('signOut')}
              </button>
            </form>
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
