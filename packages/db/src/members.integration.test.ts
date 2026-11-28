import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from './client'
import {
  countOwners,
  listMembers,
  listPendingInvitations,
  markSeen,
  recordInvitationEmail,
} from './members'
import { migrateToLatest } from './migrate'

const url = process.env.DATABASE_URL
const org = '00000000-0000-4000-8000-0000000000f1'
const other = '00000000-0000-4000-8000-0000000000f2'

describe.skipIf(!url)('members (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })
  const users: string[] = []
  const clean = async () => {
    await sql`delete from auth_invitation where "organizationId" in (${org}, ${other})`.execute(db)
    await sql`delete from auth_member where "organizationId" in (${org}, ${other})`.execute(db)
    await sql`delete from auth_user where email like '%@members.test'`.execute(db)
    await sql`delete from auth_organization where id in (${org}, ${other})`.execute(db)
    await db.deleteFrom('member_seen').where('org_id', 'in', [org, other]).execute()
    await db.deleteFrom('invitation_email').where('org_id', '=', org).execute()
  }

  beforeAll(async () => {
    await migrateToLatest(db)
    await clean()
    for (const id of [org, other]) {
      await sql`insert into auth_organization (id, name, slug, "createdAt")
        values (${id}, ${id}, ${id}, now())`.execute(db)
    }
    for (const [name, role] of [
      ['Bruno', 'admin'],
      ['Ana', 'owner'],
    ] as const) {
      const { rows } = await sql<{ id: string }>`insert into auth_user
        (name, email, "emailVerified", "createdAt", "updatedAt")
        values (${name}, ${`${name.toLowerCase()}@members.test`}, false, now(), now())
        returning id`.execute(db)
      const id = rows[0]?.id as string
      users.push(id)
      await sql`insert into auth_member ("organizationId", "userId", role, "createdAt")
        values (${org}, ${id}, ${role}, now())`.execute(db)
    }
  })
  afterAll(async () => {
    await clean()
    await pool.end()
  })

  it('lists members by name with when each last opened this organization', async () => {
    const [bruno, ana] = users as [string, string]
    await markSeen(db, org, ana, new Date('2026-11-28T03:00:00Z'))
    await markSeen(db, org, ana, new Date('2026-11-28T04:00:00Z'))
    // Opening another organization says nothing here.
    await markSeen(db, other, bruno, new Date('2026-11-28T04:00:00Z'))
    const members = await listMembers(db, org)
    expect(members.map((m) => [m.name, m.role, m.seenAt?.toISOString() ?? null])).toEqual([
      ['Ana', 'owner', '2026-11-28T04:00:00.000Z'],
      ['Bruno', 'admin', null],
    ])
    expect(await countOwners(db, org)).toBe(1)
  })

  it('tells whether the invitation email went out', async () => {
    const { rows } = await sql<{ id: string }>`insert into auth_invitation
      ("organizationId", email, role, status, "expiresAt", "inviterId")
      values (${org}, 'carla@members.test', 'member', 'pending', now() + interval '7 days', ${users[1]})
      returning id`.execute(db)
    const id = rows[0]?.id as string
    const channel = '00000000-0000-4000-8000-0000000000f3'
    expect((await listPendingInvitations(db, org))[0]).toMatchObject({
      email: 'carla@members.test',
      emailSentAt: null,
      emailError: null,
    })
    await recordInvitationEmail(db, org, id, { channelId: channel, error: 'Bad login' })
    expect((await listPendingInvitations(db, org))[0]?.emailError).toBe('Bad login')
    const sentAt = new Date('2026-11-28T04:10:00Z')
    await recordInvitationEmail(db, org, id, { channelId: channel, sentAt })
    expect((await listPendingInvitations(db, org))[0]).toMatchObject({
      emailSentAt: sentAt,
      emailError: null,
    })
  })
})
