import { listGroups, listOrgMonitors, listProjects } from '@octadash/db'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { LiveRefresh } from '@/components/live-refresh'
import { LocaleSwitcher } from '@/components/locale-switcher'
import { OrgSwitcher } from '@/components/org-switcher'
import { ProductPicker } from '@/components/product-picker'
import { UserMenu } from '@/components/user-menu'
import { AREA_ITEMS } from '@/lib/areas'
import { worstStatus } from '@/lib/monitors'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { org, orgs, user } = await requireOrg()
  const { db } = services()
  const [projects, monitors, groups, t] = await Promise.all([
    listProjects(db, org.id),
    listOrgMonitors(db, org.id),
    listGroups(db, org.id),
    getTranslations(),
  ])
  // The dot next to each product: the worst state among its running monitors.
  const statusOf = (projectId: string) =>
    worstStatus(
      monitors.filter((m) => m.project_id === projectId && !m.paused).map((m) => m.status),
    )
  // A group's dot: the worst among its products' monitors.
  const statusOfGroup = (projectIds: string[]) =>
    worstStatus(
      monitors.filter((m) => projectIds.includes(m.project_id) && !m.paused).map((m) => m.status),
    )
  const areaLabels = Object.fromEntries(
    AREA_ITEMS.map((area) => [area.id, t(`areas.${area.id}.name`)]),
  ) as Record<(typeof AREA_ITEMS)[number]['id'], string>

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <AppSidebar
        labels={{
          nav: t('nav.label'),
          overview: t('areas.overview.name'),
          settings: t('nav.settings'),
          areas: areaLabels,
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 md:px-8">
          <ProductPicker
            products={projects.map((p) => ({
              id: p.id,
              slug: p.slug,
              name: p.name,
              status: statusOf(p.id),
            }))}
            groups={groups.map((g) => ({
              slug: g.slug,
              name: g.name,
              status: statusOfGroup(g.project_ids),
            }))}
            canCreate={canManage(org.role)}
            labels={{
              label: t('picker.label'),
              all: t('picker.all'),
              search: t('picker.search'),
              none: t('picker.none'),
              new: t('picker.new'),
              groups: t('picker.groups'),
              products: t('picker.products'),
              newGroup: t('picker.newGroup'),
            }}
            newGroupLabels={{
              title: t('groups.newTitle'),
              intro: t('groups.newIntro'),
              cancel: t('common.cancel'),
              create: t('groups.create'),
            }}
            groupFormLabels={{
              name: t('groups.name'),
              placeholder: t('groups.placeholder'),
              products: t('groups.products'),
              search: t('picker.search'),
              none: t('picker.none'),
              selected: t('groups.selected', { count: '#' }),
            }}
            newProductLabels={{
              title: t('newProduct.title'),
              intro: t('newProduct.intro'),
              name: t('projects.name'),
              placeholder: t('newProduct.placeholder'),
              cancel: t('common.cancel'),
              create: t('projects.create'),
            }}
          />
          <div className="ml-auto flex items-center gap-2">
            {orgs.length > 1 && (
              <OrgSwitcher
                key={org.id}
                current={{ id: org.id, name: org.name }}
                orgs={orgs.map((o) => ({ id: o.id, name: o.name }))}
                label={t('common.organization')}
              />
            )}
            <LocaleSwitcher />
            <UserMenu
              name={user.name}
              email={user.email}
              labels={{
                account: t('common.account'),
                members: t('common.members'),
                signOut: t('common.signOut'),
              }}
            />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8 md:px-8">
          {children}
        </main>
      </div>
      <LiveRefresh />
    </div>
  )
}
