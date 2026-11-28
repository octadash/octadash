import { describe, expect, it } from 'vitest'
import {
  EnvError,
  ingestEnvSchema,
  parseEnv,
  webEnvSchema,
  withoutPort,
  workerEnvSchema,
} from './env'

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(ingestEnvSchema, {
      DATABASE_URL: 'postgres://u:p@localhost:5432/octadash',
      VALKEY_URL: 'redis://:p@localhost:6379',
    })
    expect(env.PORT).toBe(4000)
    expect(env.OCTADASH_INGEST_QUEUE_MAX).toBe(100_000)
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

  it('needs ClickHouse and Valkey for the worker', () => {
    const run = () =>
      parseEnv(workerEnvSchema, { DATABASE_URL: 'postgres://u:p@localhost:5432/octadash' })
    expect(run).toThrow(/VALKEY_URL/)
    expect(run).toThrow(/CLICKHOUSE_URL/)
  })
  it('reads the uptime reference addresses as a list', () => {
    const base = {
      DATABASE_URL: 'postgres://u:p@localhost:5432/octadash',
      VALKEY_URL: 'redis://:p@localhost:6379',
      CLICKHOUSE_URL: 'http://u:p@localhost:8123/octadash',
      OCTADASH_SECRET: 's'.repeat(32),
      OCTADASH_URL: 'https://octadash.example.com',
    }
    const env = parseEnv(workerEnvSchema, base)
    expect(env.OCTADASH_UPTIME_REFERENCE_URLS).toHaveLength(2)
    expect(env.OCTADASH_UPTIME_ALLOW_PRIVATE).toBe(false)
    const custom = parseEnv(workerEnvSchema, {
      ...base,
      OCTADASH_UPTIME_REFERENCE_URLS: ' https://a.example , ,https://b.example',
    })
    expect(custom.OCTADASH_UPTIME_REFERENCE_URLS).toEqual([
      'https://a.example',
      'https://b.example',
    ])
  })

  it('drops the container port behind a proxy (Coolify writes https://host:4000)', () => {
    const base = {
      DATABASE_URL: 'postgres://u:p@localhost:5432/octadash',
      VALKEY_URL: 'redis://:p@localhost:6379',
      CLICKHOUSE_URL: 'http://u:p@localhost:8123/octadash',
      OCTADASH_SECRET: 's'.repeat(32),
      OCTADASH_URL: 'https://panel.example.com:3000',
      OCTADASH_INGEST_URL: 'https://ingest.example.com:4000',
    }
    const kept = parseEnv(webEnvSchema, base)
    expect(kept.OCTADASH_INGEST_URL).toBe('https://ingest.example.com:4000')
    const web = parseEnv(webEnvSchema, { ...base, OCTADASH_BEHIND_PROXY: 'true' })
    expect(web.OCTADASH_URL).toBe('https://panel.example.com')
    expect(web.OCTADASH_INGEST_URL).toBe('https://ingest.example.com')
    const worker = parseEnv(workerEnvSchema, { ...base, OCTADASH_BEHIND_PROXY: 'true' })
    expect(worker.OCTADASH_URL).toBe('https://panel.example.com')
  })

  it('keeps the path when dropping the port', () => {
    expect(withoutPort('https://example.com:4000/ingest')).toBe('https://example.com/ingest')
    expect(withoutPort('https://example.com/')).toBe('https://example.com')
  })
})
