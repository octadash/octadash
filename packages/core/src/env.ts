import { z } from 'zod'

const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')

/** Settings shared by every process (web, ingest, worker). */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: logLevel,
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
})

/** ClickHouse over HTTP, database in the path: http://user:pass@clickhouse:8123/octadash */
export const clickhouseEnvSchema = z.object({
  CLICKHOUSE_URL: z.url({ protocol: /^https?$/ }),
})

/** Valkey (or Redis) holding the ingest streams: redis://:pass@valkey:6379 */
const valkeyUrl = z.url({ protocol: /^rediss?$/ })

export const webEnvSchema = baseEnvSchema
  .extend({
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
  .extend(clickhouseEnvSchema.shape)

export const ingestEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(4000),
  VALKEY_URL: valkeyUrl,
  /** Entries waiting in a stream before the ingest answers 429 (the worker is far behind). */
  OCTADASH_INGEST_QUEUE_MAX: z.coerce.number().int().positive().default(100_000),
})

export const workerEnvSchema = baseEnvSchema
  .extend({
    /** Internal port for the worker health endpoint. */
    WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4100),
    /** Decrypts the credentials of alert channels. Same value as the panel's. */
    OCTADASH_SECRET: z.string().min(32, 'OCTADASH_SECRET must have at least 32 characters'),
    /** Public URL of the panel, for links in alerts. */
    OCTADASH_URL: z.url(),
    VALKEY_URL: valkeyUrl,
    /** Let monitors reach private addresses (localhost, 10.x, 192.168.x). Only for development. */
    OCTADASH_UPTIME_ALLOW_PRIVATE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    /**
     * Addresses that prove this server is online, comma separated. Before
     * calling a monitor down the worker reaches one of them, so its own network
     * failing does not read as every product down.
     */
    OCTADASH_UPTIME_REFERENCE_URLS: z
      .string()
      .default('https://www.google.com/generate_204,https://www.cloudflare.com/cdn-cgi/trace')
      .transform((value) =>
        value
          .split(',')
          .map((url) => url.trim())
          .filter(Boolean),
      ),
  })
  .extend(clickhouseEnvSchema.shape)

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
