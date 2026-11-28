import { listChannels, listMembers, listPendingInvitations } from '@octadash/db'
import { getLocale, getTranslations } from 'next-intl/server'
import { cancelInvitationAction } from '@/actions/invitations'
import { CopyButton } from '@/components/copy-button'
import { InviteDialog } from '@/components/invite-dialog'
import { MembersTable, type Role } from '@/components/members-table'
import { SettingsHeader } from '@/components/settings-page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { services } from '@/server/context'
import { inviteChannelOf } from '@/server/invitations'
import { canManage, isOwner, requireOrg } from '@/server/session'

function roleOf(role: string | null): Role {
  if (role && isOwner(role)) return 'owner'
  if (role?.split(',').some((r) => r.trim() === 'admin')) return 'admin'
  return 'member'
}

/** "Now", "2 hr. ago", "yesterday", "12 days ago". */
function since(locale: string, at: Date, now: Date, nowText: string) {
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000)
  // "Last seen" is written at most every 5 minutes.
  if (minutes < 5) return nowText
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  if (minutes < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return rtf.format(-hours, 'hour')
  return rtf.format(-Math.floor(hours / 24), 'day')
}

/**
 * Settings › Members: who can open the organization, their roles and when
 * they last did, and the invitations still open.
 */
export default async function MembersPage() {
  const { org, user } = await requireOrg()
  const { db, env } = services()
  const [members, invitations, channels, t, common, locale] = await Promise.all([
    listMembers(db, org.id),
    listPendingInvitations(db, org.id),
    listChannels(db, org.id),
    getTranslations('members'),
    getTranslations('common'),
    getLocale(),
  ])
  const manager = canManage(org.role)
  const now = new Date()
  const roles = { owner: t('roleOwner'), admin: t('roleAdmin'), member: t('roleMember') }
  const mailer = inviteChannelOf(channels)
  const days = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <SettingsHeader
        title={t('title')}
        intro={t('intro', { org: org.name })}
        action={
          manager && (
            <InviteDialog
              labels={{
                trigger: t('invite'),
                title: t('inviteTitle', { org: org.name }),
                intro: mailer
                  ? t('inviteIntroEmail', { channel: mailer.name })
                  : t('inviteIntroLink'),
                email: t('email'),
                role: t('role'),
                roleHint: t('inviteRoleHint'),
                admin: roles.admin,
                member: roles.member,
                send: t('sendInvite'),
                close: common('close'),
              }}
            />
          )
        }
      />

      <MembersTable
        members={members.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          role: roleOf(m.role),
          you: m.userId === user.id,
          seen:
            m.userId === user.id
              ? t('now')
              : m.seenAt
                ? since(locale, m.seenAt, now, t('now'))
                : t('never'),
        }))}
        canEdit={manager}
        canTouchOwners={isOwner(org.role)}
        labels={{
          search: t('search'),
          count: { one: t('countOne'), other: t('countOther') },
          name: t('name'),
          email: t('email'),
          role: t('role'),
          roleInfo: {
            label: t('rolesInfoLabel'),
            title: t('rolesTitle'),
            owner: t('roleInfo.owner'),
            admin: t('roleInfo.admin'),
            member: t('roleInfo.member'),
          },
          lastSeen: t('lastSeen'),
          you: t('you'),
          roles,
          actions: t('actions'),
          remove: t('remove', { org: org.name }),
          removeTitle: t('removeTitle', { org: org.name, name: '{name}' }),
          removeBody: t('removeBody'),
          cancel: common('cancel'),
          nobody: t('nobody'),
        }}
      />

      {manager && invitations.length > 0 && (
        <section
          aria-labelledby="pending-title"
          className="overflow-hidden rounded-xl border border-border bg-card"
        >
          <h2 id="pending-title" className="border-b border-border px-4 py-3 text-sm font-semibold">
            {t('pending')}{' '}
            <span className="font-normal text-muted-foreground">· {invitations.length}</span>
          </h2>
          <ul className="divide-y divide-border">
            {invitations.map((inv) => {
              const left = Math.max(
                1,
                Math.ceil((inv.expiresAt.getTime() - now.getTime()) / 86_400_000),
              )
              const expires = t('expiresIn', { when: days.format(left, 'day') })
              const status = inv.emailSentAt
                ? t('emailSent')
                : inv.emailError
                  ? t('emailFailed', { error: inv.emailError })
                  : t('emailNotSent')
              return (
                <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <span className="font-medium">{inv.email}</span>
                  <Badge variant="secondary">{roles[roleOf(inv.role)]}</Badge>
                  <span
                    className={
                      inv.emailError && !inv.emailSentAt
                        ? 'text-sm text-error'
                        : 'text-sm text-muted-foreground'
                    }
                  >
                    {status} · {expires}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <CopyButton
                      value={`${env.OCTADASH_URL}/invite/${inv.id}`}
                      label={t('copyLink')}
                      copiedLabel={common('copied')}
                      name={inv.email}
                    />
                    <form action={cancelInvitationAction}>
                      <input type="hidden" name="invitationId" value={inv.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={`${t('cancelInvite')}, ${inv.email}`}
                      >
                        {t('cancelInvite')}
                      </Button>
                    </form>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
