import { createDb } from '@octadash/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { migrateAll } from './migrate'
import { canSignUp, needsSetup } from './signup-policy'

const url = process.env.DATABASE_URL

describe.skipIf(!url)('sign-up policy (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })

  beforeAll(async () => {
    await migrateAll(db, pool)
  })
  beforeEach(async () => {
    await pool.query('delete from auth_invitation')
    await pool.query('delete from auth_member')
    await pool.query('delete from auth_organization')
    await pool.query('delete from auth_user')
  })
  afterAll(async () => {
    await pool.end()
  })

  it('lets the first person in', async () => {
    expect(await needsSetup(pool)).toBe(true)
    expect(await canSignUp(pool, 'owner@example.com', false)).toBe(true)
  })

  it('closes sign-up once someone exists, except for invitations', async () => {
    const owner = await pool.query<{ id: string }>(
      `insert into auth_user (name, email, "emailVerified", "createdAt", "updatedAt")
       values ('Owner', 'owner@example.com', false, now(), now()) returning id`,
    )
    const org = await pool.query<{ id: string }>(
      `insert into auth_organization (name, slug, "createdAt") values ('Acme', 'acme', now()) returning id`,
    )
    expect(await needsSetup(pool)).toBe(false)
    expect(await canSignUp(pool, 'stranger@example.com', false)).toBe(false)
    expect(await canSignUp(pool, 'stranger@example.com', true)).toBe(true)

    await pool.query(
      `insert into auth_invitation ("organizationId", email, role, status, "expiresAt", "inviterId", "createdAt")
       values ($1, 'Friend@Example.com', 'member', 'pending', now() + interval '1 day', $2, now())`,
      [org.rows[0]?.id, owner.rows[0]?.id],
    )
    expect(await canSignUp(pool, 'friend@example.com', false)).toBe(true)
  })
})
