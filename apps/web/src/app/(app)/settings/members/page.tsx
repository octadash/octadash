import { getFormatter, getTranslations } from 'next-intl/server'
import { cancelInvitationAction, inviteAction } from '@/actions/invitations'
import { ActionForm } from '@/components/action-form'
import { CopyField } from '@/components/copy-field'
import { SubmitButton } from '@/components/submit-button'
import { Badge, Button, Card, Field, Input, Select } from '@/components/ui'
import { services } from '@/server/context'
import { canManage, requireOrg } from '@/server/session'

function roleKey(role: string | null) {
  if (role?.includes('owner')) return 'roleOwner' as const
  if (role?.includes('admin')) return 'roleAdmin' as const
  return 'roleMember' as const
}

export default async function MembersPage() {
  const { org, user } = await requireOrg()
  const { db, env } = services()
  const [members, invitations, t, format] = await Promise.all([
    db
      .selectFrom('auth_member')
      .innerJoin('auth_user', 'auth_user.id', 'auth_member.userId')
      .select([
        'auth_member.id',
        'auth_member.role',
        'auth_user.id as userId',
        'auth_user.name',
        'auth_user.email',
      ])
      .where('auth_member.organizationId', '=', org.id)
      .orderBy('auth_user.name')
      .execute(),
    db
      .selectFrom('auth_invitation')
      .select(['id', 'email', 'role', 'expiresAt'])
      .where('organizationId', '=', org.id)
      .where('status', '=', 'pending')
      .where('expiresAt', '>', new Date())
      .orderBy('createdAt', 'desc')
      .execute(),
    getTranslations('members'),
    getFormatter(),
  ])
  const manager = canManage(org.role)
  const common = await getTranslations('common')

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted">{t('intro', { org: org.name })}</p>
      </div>

      <section className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
        {members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
            <span className="font-medium">{m.name}</span>
            {m.userId === user.id && <span className="text-xs text-muted">({t('you')})</span>}
            <span className="text-sm text-muted">{m.email}</span>
            <span className="ml-auto">
              <Badge tone={m.role.includes('owner') ? 'accent' : 'muted'}>
                {t(roleKey(m.role))}
              </Badge>
            </span>
          </div>
        ))}
      </section>

      {manager && invitations.length > 0 && (
        <Card className="flex flex-col gap-4">
          <h2 className="font-display text-lg font-semibold">{t('pending')}</h2>
          {invitations.map((inv) => (
            <div
              key={inv.id}
              className="flex flex-col gap-2 border-t border-line pt-4 first:border-0 first:pt-0"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{inv.email}</span>
                <Badge>{t(roleKey(inv.role))}</Badge>
                <span className="text-xs text-muted">
                  {t('expires', { date: format.dateTime(inv.expiresAt, { dateStyle: 'medium' }) })}
                </span>
                <form action={cancelInvitationAction} className="ml-auto">
                  <input type="hidden" name="invitationId" value={inv.id} />
                  <Button type="submit" variant="ghost" className="h-7 px-2 text-xs">
                    {t('cancelInvite')}
                  </Button>
                </form>
              </div>
              <span className="text-xs text-muted">{t('inviteLink')}</span>
              <CopyField
                value={`${env.OCTADASH_URL}/invite/${inv.id}`}
                copyLabel={common('copy')}
                copiedLabel={common('copied')}
              />
            </div>
          ))}
        </Card>
      )}

      {manager && (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-lg font-semibold">{t('inviteTitle')}</h2>
            <p className="text-sm text-muted">{t('inviteIntro')}</p>
          </div>
          <ActionForm
            action={inviteAction}
            className="flex flex-col gap-4 sm:flex-row sm:items-end"
          >
            <div className="flex-1">
              <Field label="E-mail">
                <Input name="email" type="email" required />
              </Field>
            </div>
            <Field label={t('role')}>
              <Select name="role" defaultValue="member">
                <option value="member">{t('roleMember')}</option>
                <option value="admin">{t('roleAdmin')}</option>
              </Select>
            </Field>
            <SubmitButton>{t('invite')}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  )
}
