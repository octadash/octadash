import type pg from 'pg'

/**
 * Runs `fn` while holding a Postgres advisory lock, so only one process at a
 * time does it (several roles start together and all apply migrations). The
 * lock is tied to the session and released even if the process dies.
 */
export async function withAdvisoryLock<T>(
  pool: pg.Pool,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [name])
    try {
      return await fn()
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [name])
    }
  } finally {
    client.release()
  }
}
