import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { SettingsNav } from '@/components/settings-nav'
import { StorageBanner } from '@/components/storage-banner'
import { WatcherBanner } from '@/components/watcher-banner'
import { isOwner, requireOrg } from '@/server/session'

/** Settings: a grouped menu on the left, the page on the right. */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const [{ org }, t] = await Promise.all([requireOrg(), getTranslations('settings')])
  const owner = isOwner(org.role)
  return (
    <div className="flex flex-col gap-8 md:flex-row">
      <SettingsNav
        labels={{ nav: t('nav'), search: t('search'), none: t('none') }}
        sections={[
          {
            title: t('sections.organization'),
            items: [
              { href: '/settings/general', label: t('general'), keywords: t('generalKeywords') },
              { href: '/settings/members', label: t('members'), keywords: t('membersKeywords') },
              { href: '/settings/groups', label: t('productGroups') },
            ],
          },
          {
            title: t('sections.alerts'),
            items: [
              { href: '/settings/channels', label: t('channels'), keywords: t('channelsKeywords') },
              { href: '/settings/alerts', label: t('alerts') },
            ],
          },
          ...(owner
            ? [
                {
                  title: t('sections.install'),
                  note: t('ownerOnly'),
                  items: [
                    { href: '/settings/watcher', label: t('watcher') },
                    {
                      href: '/settings/storage',
                      label: t('storage'),
                      keywords: t('storageKeywords'),
                    },
                    { href: '/settings/organizations', label: t('organizations') },
                  ],
                },
              ]
            : []),
          {
            title: t('sections.you'),
            items: [
              { href: '/settings/profile', label: t('profile'), keywords: t('profileKeywords') },
            ],
          },
        ]}
        footer={t('productNote')}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <WatcherBanner />
        <StorageBanner />
        {children}
      </div>
    </div>
  )
}
