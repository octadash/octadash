import { getFormatter, getTranslations } from 'next-intl/server'
import { cancelInvitationAction, inviteAction } from '@/actions/invitations'
import { ActionForm } from '@/components/action-form'
import { CopyField } from '@/components/copy-field'
import { Field } from '@/components/field'
import { RoleSelect } from '@/components/role-select'
import { SubmitButton } from '@/components/submit-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
        <p className="text-sm text-muted-foreground">{t('intro', { org: org.name })}</p>
      </div>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">{t('name')}</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead className="pr-4 text-right">{t('role')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="pl-4 font-medium">
                  {m.name}
                  {m.userId === user.id && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ({t('you')})
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{m.email}</TableCell>
                <TableCell className="pr-4 text-right">
                  <Badge variant={m.role.includes('owner') ? 'brand' : 'secondary'}>
                    {t(roleKey(m.role))}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {manager && invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="font-display text-lg font-semibold">{t('pending')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-col gap-2 border-t border-border pt-4 first:border-0 first:pt-0"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{inv.email}</span>
                  <Badge variant="secondary">{t(roleKey(inv.role))}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {t('expires', {
                      date: format.dateTime(inv.expiresAt, { dateStyle: 'medium' }),
                    })}
                  </span>
                  <form action={cancelInvitationAction} className="ml-auto">
                    <input type="hidden" name="invitationId" value={inv.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {t('cancelInvite')}
                    </Button>
                  </form>
                </div>
                <span className="text-xs text-muted-foreground">{t('inviteLink')}</span>
                <CopyField
                  value={`${env.OCTADASH_URL}/invite/${inv.id}`}
                  copyLabel={common('copy')}
                  copiedLabel={common('copied')}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {manager && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="font-display text-lg font-semibold">{t('inviteTitle')}</h2>
            </CardTitle>
            <CardDescription>{t('inviteIntro')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ActionForm
              action={inviteAction}
              className="flex flex-col gap-4 sm:flex-row sm:items-end"
            >
              <div className="flex-1">
                <Field label="E-mail">
                  <Input name="email" type="email" required />
                </Field>
              </div>
              <RoleSelect
                label={t('role')}
                options={[
                  { value: 'member', label: t('roleMember') },
                  { value: 'admin', label: t('roleAdmin') },
                ]}
              />
              <SubmitButton>{t('invite')}</SubmitButton>
            </ActionForm>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
