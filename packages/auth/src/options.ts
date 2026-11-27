import { APIError, type BetterAuthOptions, betterAuth } from 'better-auth'
import { organization } from 'better-auth/plugins/organization'
import type pg from 'pg'
import { canSignUp } from './signup-policy'

export interface AuthConfig {
  pool: pg.Pool
  /** OCTADASH_SECRET */
  secret: string
  /** OCTADASH_URL */
  baseURL: string
  /** OCTADASH_OPEN_SIGNUP: anyone can create an account (cloud). Off for self-hosting. */
  openSignup?: boolean
}

/**
 * Accounts and organizations. Tables are prefixed with `auth_` so they stay apart
 * from Octadash's own tables; ids are UUIDs so `org_id` columns elsewhere are uuid.
 * Better Auth names its columns in camelCase ("createdAt"); Octadash tables use
 * snake_case.
 */
export function buildAuthOptions(config: AuthConfig) {
  return {
    appName: 'Octadash',
    database: config.pool,
    secret: config.secret,
    baseURL: config.baseURL,
    user: { modelName: 'auth_user' },
    session: { modelName: 'auth_session' },
    account: { modelName: 'auth_account' },
    verification: { modelName: 'auth_verification' },
    emailAndPassword: { enabled: true, minPasswordLength: 10, autoSignIn: true },
    advanced: { database: { generateId: 'uuid' } },
    telemetry: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          before: async (user: { email: string }) => {
            if (!(await canSignUp(config.pool, user.email, config.openSignup ?? false))) {
              throw new APIError('FORBIDDEN', {
                message: 'Sign-up is closed. Ask an owner of this Octadash for an invitation.',
              })
            }
          },
        },
      },
    },
    plugins: [
      organization({
        invitationExpiresIn: 7 * 24 * 60 * 60,
        schema: {
          organization: { modelName: 'auth_organization' },
          member: { modelName: 'auth_member' },
          invitation: { modelName: 'auth_invitation' },
        },
      }),
    ],
  } satisfies BetterAuthOptions
}

export function createAuth(config: AuthConfig) {
  return betterAuth(buildAuthOptions(config))
}

export type Auth = ReturnType<typeof createAuth>
