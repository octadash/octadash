import { describe, expect, it } from 'vitest'
import { EnvError, ingestEnvSchema, parseEnv, webEnvSchema } from './env'

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(ingestEnvSchema, {
      DATABASE_URL: 'postgres://u:p@localhost:5432/octadash',
    })
    expect(env.PORT).toBe(4000)
    expect(env.LOG_LEVEL).toBe('info')
  })

  it('lists every problem in one error', () => {
    expect(() =>
      parseEnv(webEnvSchema, { DATABASE_URL: 'mysql://x', OCTADASH_SECRET: 'short' }),
    ).toThrow(EnvError)
    try {
      parseEnv(webEnvSchema, { DATABASE_URL: 'mysql://x', OCTADASH_SECRET: 'short' })
    } catch (error) {
      const message = (error as Error).message
      expect(message).toContain('DATABASE_URL')
      expect(message).toContain('OCTADASH_URL')
      expect(message).toContain('OCTADASH_SECRET')
    }
  })
})
