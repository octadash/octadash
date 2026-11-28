import { TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { storageState } from '@/lib/storage'
import { cn } from '@/lib/utils'
import { readStorageStatus } from '@/server/live'
import { isOwner, requireOrg } from '@/server/session'
import { UnlessPath } from './unless-path'

/**
 * Shown to owners on every settings page while file storage needs them: not
 * set, not answering, or almost full. Red when files are being lost.
 */
export async function StorageBanner() {
  const { org } = await requireOrg()
  if (!isOwner(org.role)) return null
  const state = storageState(await readStorageStatus(), Date.now())
  if (state !== 'off' && state !== 'failing' && state !== 'full') return null
  const t = await getTranslations('storage.warning')
  const strong = state !== 'full'
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
        <p className="font-medium">{t(`${state}Title`)}</p>
        <p className="text-muted-foreground">{t(`${state}Body`)}</p>
        <UnlessPath path="/settings/storage">
          <Link
            href="/settings/storage"
            className="self-start font-medium text-brand underline-offset-4 hover:underline"
          >
            {t('action')}
          </Link>
        </UnlessPath>
      </div>
    </div>
  )
}
