import { getTranslations } from 'next-intl/server'
import { signOutAction } from '@/actions/auth'
import { Button, Card } from '@/components/ui'
import { requireViewer } from '@/server/session'

export default async function NoOrganizationPage() {
  await requireViewer()
  const t = await getTranslations()
  return (
    <Card className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">{t('auth.noOrgTitle')}</h1>
      <p className="text-sm text-muted">{t('auth.noOrgBody')}</p>
      <form action={signOutAction}>
        <Button type="submit" variant="secondary">
          {t('common.signOut')}
        </Button>
      </form>
    </Card>
  )
}
