import { z } from 'zod'

const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')

/** Settings shared by every process (web, ingest, worker). */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: logLevel,
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
})

export const webEnvSchema = baseEnvSchema.extend({
  /** Public URL of the panel, e.g. https://octadash.example.com */
  OCTADASH_URL: z.url(),
  /** Public URL of the ingest service, used in SDK snippets and DSNs. */
  OCTADASH_INGEST_URL: z.url(),
  /** Secret used to sign sessions and encrypt integration credentials. */
  OCTADASH_SECRET: z.string().min(32, 'OCTADASH_SECRET must have at least 32 characters'),
  /** Anyone may create an account. Off on self-hosted installs: only the owner and invited people. */
  OCTADASH_OPEN_SIGNUP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
})

export const ingestEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4000),
})

export const workerEnvSchema = baseEnvSchema.extend({
  /** Internal port for the worker health endpoint. */
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4100),
})

export type BaseEnv = z.infer<typeof baseEnvSchema>
export type WebEnv = z.infer<typeof webEnvSchema>
export type IngestEnv = z.infer<typeof ingestEnvSchema>
export type WorkerEnv = z.infer<typeof workerEnvSchema>

export class EnvError extends Error {
  override name = 'EnvError'
}

/**
 * Parses environment variables with a schema and fails with one readable message
 * listing every problem, so a misconfigured install says exactly what to fix.
 */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const result = schema.safeParse(source)
  if (result.success) return result.data
  const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
  throw new EnvError(`Invalid environment configuration:\n${lines.join('\n')}`)
}
