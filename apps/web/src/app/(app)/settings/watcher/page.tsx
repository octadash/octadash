import { getWatcher } from '@octadash/db'
import { getFormatter, getTranslations } from 'next-intl/server'
import { removeWatcherAction, saveWatcherAction } from '@/actions/watcher'
import { ActionForm } from '@/components/action-form'
import { Field } from '@/components/field'
import { StatusDot } from '@/components/status-dot'
import { SubmitButton } from '@/components/submit-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

export default async function WatcherPage() {
  const { org } = await requireOrg()
  const [watcher, t, format] = await Promise.all([
    getWatcher(services().db),
    getTranslations('watcher'),
    getFormatter(),
  ])
  const manager = canManage(org.role)
  const configured = Boolean(watcher?.watcher_url)
  const checkedAt = watcher?.watcher_checked_at

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </div>

      {configured && (
        <Card>
          <CardContent className="flex items-center gap-3 text-sm">
            <StatusDot
              status={
                watcher?.watcher_status === 'ok'
                  ? 'up'
                  : watcher?.watcher_status === 'failing'
                    ? 'down'
                    : 'unknown'
              }
            />
            <span>
              {watcher?.watcher_status === 'failing'
                ? t('failing', { error: watcher.watcher_error ?? '' })
                : checkedAt
                  ? t('ok', { when: format.relativeTime(checkedAt) })
                  : t('waiting')}
            </span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="font-display text-lg font-semibold">{t('howTitle')}</h2>
          </CardTitle>
          <CardDescription>{t('howIntro')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
            <li>
              {t.rich('step1', {
                link: (chunks) => (
                  <a
                    href="https://healthchecks.io"
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand underline-offset-4 hover:underline"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </li>
            <li>{t('step2')}</li>
            <li>{t('step3')}</li>
            <li>{t('step4')}</li>
          </ol>
          {manager && (
            <ActionForm action={saveWatcherAction} className="flex flex-col gap-3">
              <Field label={t('url')} hint={configured ? t('urlSaved') : undefined}>
                <Input
                  name="url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  placeholder="https://hc-ping.com/..."
                  required
                />
              </Field>
              <SubmitButton className="self-start">
                {configured ? t('replace') : t('save')}
              </SubmitButton>
            </ActionForm>
          )}
          {manager && configured && (
            <ActionForm action={removeWatcherAction}>
              <SubmitButton variant="ghost" className="self-start text-muted-foreground">
                {t('remove')}
              </SubmitButton>
            </ActionForm>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
