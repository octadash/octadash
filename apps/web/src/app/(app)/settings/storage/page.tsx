import { redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { SettingsCard, SettingsHeader } from '@/components/settings-page'
import { StatusDot } from '@/components/status-dot'
import { Progress } from '@/components/ui/progress'
import { readableBytes } from '@/lib/logs'
import { isBundled, storageState } from '@/lib/storage'
import { readStorageStatus } from '@/server/live'
import { isOwner, requireOrg } from '@/server/session'

/**
 * Settings › File storage (owners): where attachments, replays, profiles and
 * anything over 1 MB are kept, whether the bucket answers, how much it holds
 * against its limit, and how to point it somewhere else. The worker looks
 * every hour; this page shows its last look.
 */
export default async function StoragePage() {
  const { org } = await requireOrg()
  if (!isOwner(org.role)) redirect('/settings/general')
  const [status, t, format, locale] = await Promise.all([
    readStorageStatus(),
    getTranslations('storage'),
    getFormatter(),
    getLocale(),
  ])
  const state = storageState(status, Date.now())
  const bytes = (n: number) => readableBytes(n, locale)
  const percent =
    status && status.limitBytes > 0
      ? Math.min(100, Math.round((status.usedBytes / status.limitBytes) * 100))
      : null

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SettingsHeader title={t('title')} intro={t('intro')} />

      <SettingsCard title={t('statusTitle')}>
        <p className="flex items-center gap-3 text-sm">
          <StatusDot
            status={
              state === 'ok' || state === 'trimmed'
                ? 'up'
                : state === 'failing' || state === 'off'
                  ? 'down'
                  : 'unknown'
            }
          />
          <span>
            {state === 'unknown'
              ? t('unknown')
              : state === 'off'
                ? t('off')
                : state === 'failing'
                  ? t('failing', { error: status?.error ?? '' })
                  : t('ok', { when: format.relativeTime(new Date(status?.checkedAt ?? 0)) })}
          </span>
        </p>
        {status?.configured && (
          <p className="text-sm text-muted-foreground">
            {isBundled(status.host) ? t('bundled') : t('external', { host: status.host ?? '' })}
          </p>
        )}
      </SettingsCard>

      {status?.configured && (
        <SettingsCard title={t('usageTitle')}>
          {percent === null ? (
            <p className="text-sm">{t('usedNoLimit', { used: bytes(status.usedBytes) })}</p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                {t('used', {
                  used: bytes(status.usedBytes),
                  limit: bytes(status.limitBytes),
                  percent,
                })}
              </p>
              <Progress value={percent} aria-label={t('usageTitle')} />
              {state === 'full' && <p className="text-sm font-medium">{t('almostFull')}</p>}
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {t('retention', { days: status.retentionDays })}
          </p>
          {status.trimmed && (
            <p className="text-sm">
              {t('trimmed', {
                day: format.dateTime(new Date(`${status.trimmed.day}T12:00:00Z`), {
                  dateStyle: 'medium',
                }),
                when: format.relativeTime(new Date(status.trimmed.at)),
                files: status.trimmed.files,
              })}
            </p>
          )}
        </SettingsCard>
      )}

      <SettingsCard title={t('howTitle')}>
        <p className="text-sm text-muted-foreground">{t('howIntro')}</p>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>{t.rich('howLimit', { code: (chunks) => <code>{chunks}</code> })}</li>
          <li>{t.rich('howExternal', { code: (chunks) => <code>{chunks}</code> })}</li>
          <li>{t('howBackup')}</li>
        </ul>
      </SettingsCard>
    </div>
  )
}
