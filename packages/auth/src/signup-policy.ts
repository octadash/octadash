import type pg from 'pg'

/**
 * Who may create an account on a self-hosted install:
 * - the very first person (the setup wizard creates the owner);
 * - anyone holding a pending invitation for that email;
 * - anyone at all, only when OCTADASH_OPEN_SIGNUP=true (the future cloud).
 */
export async function canSignUp(
  pool: pg.Pool,
  email: string,
  openSignup: boolean,
): Promise<boolean> {
  if (openSignup) return true
  const users = await pool.query<{ exists: boolean }>(
    'select exists (select 1 from auth_user) as exists',
  )
  if (!users.rows[0]?.exists) return true
  const invited = await pool.query<{ exists: boolean }>(
    `select exists (
       select 1 from auth_invitation
       where lower(email) = lower($1) and status = 'pending' and "expiresAt" > now()
     ) as exists`,
    [email],
  )
  return invited.rows[0]?.exists ?? false
}

/** True when no account exists yet, which sends the browser to the setup wizard. */
export async function needsSetup(pool: pg.Pool): Promise<boolean> {
  const users = await pool.query<{ exists: boolean }>(
    'select exists (select 1 from auth_user) as exists',
  )
  return !users.rows[0]?.exists
}
