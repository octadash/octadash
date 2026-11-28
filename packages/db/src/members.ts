import type { Db } from './client'

/**
 * The people of an organization, as Settings › Members lists them: who they
 * are, their role, when they last opened it, and the invitations still open.
 */

export interface MemberRow {
  id: string
  userId: string
  name: string
  email: string
  role: string
  seenAt: Date | null
}

export async function listMembers(db: Db, orgId: string): Promise<MemberRow[]> {
  const rows = await db
    .selectFrom('auth_member')
    .innerJoin('auth_user', 'auth_user.id', 'auth_member.userId')
    .leftJoin('member_seen', (join) =>
      join
        .onRef('member_seen.user_id', '=', 'auth_member.userId')
        .on('member_seen.org_id', '=', orgId),
    )
    .select([
      'auth_member.id',
      'auth_member.role',
      'auth_user.id as userId',
      'auth_user.name',
      'auth_user.email',
      'member_seen.seen_at',
    ])
    .where('auth_member.organizationId', '=', orgId)
    .orderBy('auth_user.name')
    .execute()
  return rows.map(({ seen_at, ...row }) => ({ ...row, seenAt: seen_at ?? null }))
}

/** Records that someone opened the organization now. */
export async function markSeen(db: Db, orgId: string, userId: string, at = new Date()) {
  await db
    .insertInto('member_seen')
    .values({ org_id: orgId, user_id: userId, seen_at: at })
    .onConflict((oc) => oc.columns(['org_id', 'user_id']).doUpdateSet({ seen_at: at }))
    .execute()
}

export interface PendingInvitation {
  id: string
  email: string
  role: string | null
  expiresAt: Date
  emailSentAt: Date | null
  emailError: string | null
}

export async function listPendingInvitations(
  db: Db,
  orgId: string,
  now = new Date(),
): Promise<PendingInvitation[]> {
  const rows = await db
    .selectFrom('auth_invitation')
    .leftJoin('invitation_email', 'invitation_email.invitation_id', 'auth_invitation.id')
    .select([
      'auth_invitation.id',
      'auth_invitation.email',
      'auth_invitation.role',
      'auth_invitation.expiresAt',
      'invitation_email.sent_at',
      'invitation_email.error',
    ])
    .where('auth_invitation.organizationId', '=', orgId)
    .where('auth_invitation.status', '=', 'pending')
    .where('auth_invitation.expiresAt', '>', now)
    .orderBy('auth_invitation.createdAt', 'desc')
    .execute()
  return rows.map(({ sent_at, error, ...row }) => ({
    ...row,
    emailSentAt: sent_at ?? null,
    emailError: error ?? null,
  }))
}

/** Keeps whether the invitation email went out, so the list can say it. */
export async function recordInvitationEmail(
  db: Db,
  orgId: string,
  invitationId: string,
  result: { channelId: string; sentAt: Date } | { channelId: string; error: string },
) {
  const values = {
    invitation_id: invitationId,
    org_id: orgId,
    channel_id: result.channelId,
    sent_at: 'sentAt' in result ? result.sentAt : null,
    error: 'error' in result ? result.error.slice(0, 500) : null,
  }
  await db
    .insertInto('invitation_email')
    .values(values)
    .onConflict((oc) =>
      oc.column('invitation_id').doUpdateSet({
        channel_id: values.channel_id,
        sent_at: values.sent_at,
        error: values.error,
      }),
    )
    .execute()
}

/** Owners left in the organization, to keep at least one. */
export async function countOwners(db: Db, orgId: string): Promise<number> {
  const rows = await db
    .selectFrom('auth_member')
    .select('role')
    .where('organizationId', '=', orgId)
    .execute()
  return rows.filter((row) => row.role.split(',').some((r) => r.trim() === 'owner')).length
}
