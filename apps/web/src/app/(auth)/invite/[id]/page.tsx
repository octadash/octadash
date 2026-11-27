import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { signOutAction } from '@/actions/auth'
import { acceptInvitationAction, signUpInvitedAction } from '@/actions/invitations'
import { ActionForm } from '@/components/action-form'
import { Field } from '@/components/field'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { services } from '@/server/context'
import { getViewer } from '@/server/session'

async function findInvitation(id: string) {
  return services()
    .db.selectFrom('auth_invitation')
    .innerJoin('auth_organization', 'auth_organization.id', 'auth_invitation.organizationId')
    .select([
      'auth_invitation.id',
      'auth_invitation.email',
      'auth_invitation.role',
      'auth_organization.name as orgName',
    ])
    .where('auth_invitation.id', '=', id)
    .where('auth_invitation.status', '=', 'pending')
    .where('auth_invitation.expiresAt', '>', new Date())
    .executeTakeFirst()
}

export default async function InvitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const t = await getTranslations()
  const invitation = await findInvitation(id)

  if (!invitation) {
    return (
      <Card>
        <CardContent>
          <p className="text-sm">{t('auth.invitationInvalid')}</p>
        </CardContent>
      </Card>
    )
  }

  const role = t(invitation.role === 'admin' ? 'members.roleAdmin' : 'members.roleMember')
  const viewer = await getViewer()

  if (viewer && viewer.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm">
            {t('auth.wrongAccount', { email: invitation.email, current: viewer.user.email })}
          </p>
          <form action={signOutAction}>
            <Button type="submit" variant="outline">
              {t('common.signOut')}
            </Button>
          </form>
        </CardContent>
      </Card>
    )
  }

  if (viewer) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="font-display text-xl font-semibold">
              {t('auth.acceptTitle', { org: invitation.orgName })}
            </h1>
          </CardTitle>
          <CardDescription>{t('auth.acceptIntro', { email: viewer.user.email })}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActionForm action={acceptInvitationAction}>
            <input type="hidden" name="invitationId" value={invitation.id} />
            <SubmitButton>{t('auth.accept')}</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="font-display text-xl font-semibold">
            {t('auth.inviteTitle', { org: invitation.orgName })}
          </h1>
        </CardTitle>
        <CardDescription>{t('auth.inviteIntro', { role })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ActionForm action={signUpInvitedAction}>
          <input type="hidden" name="invitationId" value={invitation.id} />
          <Field label={t('auth.email')}>
            <Input value={invitation.email} disabled readOnly />
          </Field>
          <Field label={t('auth.name')}>
            <Input name="name" autoComplete="name" required />
          </Field>
          <Field label={t('auth.password')} hint={t('auth.passwordHint')}>
            <Input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
            />
          </Field>
          <SubmitButton>{t('auth.join')}</SubmitButton>
        </ActionForm>
        <Link
          href={`/sign-in?next=/invite/${invitation.id}`}
          className="text-sm text-muted-foreground hover:text-brand"
        >
          {t('auth.haveAccount')}
        </Link>
      </CardContent>
    </Card>
  )
}
