import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { RulesList } from '@/components/rules-list'
import { canManage, requireOrg } from '@/server/session'

export default async function AlertsPage() {
  const { org } = await requireOrg()
  const t = await getTranslations('alerts')
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t.rich('intro', {
            channels: (chunks) => (
              <Link
                href="/settings/channels"
                className="text-brand underline-offset-4 hover:underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
      <RulesList orgId={org.id} canEdit={canManage(org.role)} />
    </div>
  )
}
