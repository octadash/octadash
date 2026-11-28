import { getWatcher, listOrgMonitors } from '@octadash/db'
import { TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { cn } from '@/lib/utils'
import { services } from '@/server/context'
import { sameServerUrls } from '@/server/same-server'
import { canManage, requireOrg } from '@/server/session'
import { UnlessPath } from './unless-path'

/**
 * Shown on every settings page until the outside watcher works. Red when a
 * monitor runs on Octadash's own server: if that server goes down, the product
 * and its alerts go down together.
 */
export async function WatcherBanner() {
  const { org } = await requireOrg()
  if (!canManage(org.role)) return null
  const { db, env } = services()
  const watcher = await getWatcher(db)
  const missing = !watcher?.watcher_url
  const failing = watcher?.watcher_status === 'failing'
  if (!missing && !failing) return null
  const monitors = await listOrgMonitors(db, org.id)
  const urls = monitors.filter((m) => m.url && !m.paused).map((m) => m.url as string)
  const shared = missing ? (await sameServerUrls(env.OCTADASH_URL, urls)).size : 0
  const t = await getTranslations('watcher.warning')
  const strong = failing || shared > 0
  return (
    <div
      role="alert"
      className={cn(
        'flex gap-3 rounded-lg border p-3 text-sm',
        strong ? 'border-error/40 bg-error/10' : 'border-warn/40 bg-warn/10',
      )}
    >
      <TriangleAlertIcon
        className={cn('mt-0.5 size-4 shrink-0', strong ? 'text-error' : 'text-warn')}
      />
      <div className="flex flex-col gap-1">
        <p className="font-medium">
          {failing
            ? t('failingTitle')
            : shared > 0
              ? t('sharedTitle', { count: shared })
              : t('missingTitle')}
        </p>
        <p className="text-muted-foreground">{failing ? t('failingBody') : t('missingBody')}</p>
        <UnlessPath path="/settings/watcher">
          <Link
            href="/settings/watcher"
            className="self-start font-medium text-brand underline-offset-4 hover:underline"
          >
            {t('action')}
          </Link>
        </UnlessPath>
      </div>
    </div>
  )
}
