import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { SettingsNav } from '@/components/settings-nav'
import { WatcherBanner } from '@/components/watcher-banner'

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('settings')
  return (
    <div className="flex flex-col gap-6">
      <SettingsNav
        items={[
          { href: '/settings/members', label: t('members') },
          { href: '/settings/channels', label: t('channels') },
          { href: '/settings/alerts', label: t('alerts') },
          { href: '/settings/watcher', label: t('watcher') },
        ]}
      />
      <WatcherBanner />
      {children}
    </div>
  )
}
