import { getTranslations } from 'next-intl/server'
import { signOutAction } from '@/actions/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireViewer } from '@/server/session'

export default async function NoOrganizationPage() {
  await requireViewer()
  const t = await getTranslations()
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="font-display text-xl font-semibold">{t('auth.noOrgTitle')}</h1>
        </CardTitle>
        <CardDescription>{t('auth.noOrgBody')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={signOutAction}>
          <Button type="submit" variant="outline">
            {t('common.signOut')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
