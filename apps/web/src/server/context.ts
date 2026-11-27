import { buildAuthOptions } from '@octadash/auth'
import { parseEnv, webEnvSchema } from '@octadash/core'
import { createDb } from '@octadash/db'
import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'

/**
 * Process-wide services for the panel. Created on first use, not at import time,
 * so `next build` works without a database or secrets.
 */
function createServices() {
  const env = parseEnv(webEnvSchema)
  const { db, pool } = createDb(env.DATABASE_URL, { applicationName: 'octadash-web' })
  const options = buildAuthOptions({
    pool,
    secret: env.OCTADASH_SECRET,
    baseURL: env.OCTADASH_URL,
    openSignup: env.OCTADASH_OPEN_SIGNUP,
  })
  // nextCookies lets server actions set the session cookie; it must be the last plugin.
  const auth = betterAuth({ ...options, plugins: [...options.plugins, nextCookies()] })
  return { env, db, pool, auth }
}

type Services = ReturnType<typeof createServices>

// Kept on globalThis so hot reload in development does not open new pools.
const store = globalThis as unknown as { __octadash?: Services }

export function services(): Services {
  store.__octadash ??= createServices()
  return store.__octadash
}
