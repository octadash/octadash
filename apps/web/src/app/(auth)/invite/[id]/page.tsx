import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { signOutAction } from '@/actions/auth'
import { acceptInvitationAction, signUpInvitedAction } from '@/actions/invitations'
import { ActionForm } from '@/components/action-form'
import { SubmitButton } from '@/components/submit-button'
import { Button, Card, Field, Input } from '@/components/ui'
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
        <p className="text-sm">{t('auth.invitationInvalid')}</p>
      </Card>
    )
  }

  const role = t(invitation.role === 'admin' ? 'members.roleAdmin' : 'members.roleMember')
  const viewer = await getViewer()

  if (viewer && viewer.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <Card className="flex flex-col gap-4">
        <p className="text-sm">
          {t('auth.wrongAccount', { email: invitation.email, current: viewer.user.email })}
        </p>
        <form action={signOutAction}>
          <Button type="submit" variant="secondary">
            {t('common.signOut')}
          </Button>
        </form>
      </Card>
    )
  }

  if (viewer) {
    return (
      <Card className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-xl font-semibold">
            {t('auth.acceptTitle', { org: invitation.orgName })}
          </h1>
          <p className="text-sm text-muted">
            {t('auth.acceptIntro', { email: viewer.user.email })}
          </p>
        </div>
        <ActionForm action={acceptInvitationAction}>
          <input type="hidden" name="invitationId" value={invitation.id} />
          <SubmitButton>{t('auth.accept')}</SubmitButton>
        </ActionForm>
      </Card>
    )
  }

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-xl font-semibold">
          {t('auth.inviteTitle', { org: invitation.orgName })}
        </h1>
        <p className="text-sm text-muted">{t('auth.inviteIntro', { role })}</p>
      </div>
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
        className="text-sm text-muted hover:text-accent"
      >
        {t('auth.haveAccount')}
      </Link>
    </Card>
  )
}
