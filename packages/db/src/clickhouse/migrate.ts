import type { ClickHouseClient } from '@clickhouse/client'
import { createClickHouse, parseClickHouseUrl } from './client'
import { clickhouseMigrations } from './migrations'

export interface ClickHouseMigration {
  name: string
  statements: string[]
}

export interface ClickHouseMigrationResult {
  migrationName: string
  status: 'Success'
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class ClickHouseUnavailableError extends Error {
  override name = 'ClickHouseUnavailableError'
}

/**
 * Waits for ClickHouse to answer. The message on failure names the usual cause
 * on self-hosted installs: the official amd64 image needs an x86-64-v3 CPU
 * (AVX2), and on an older CPU the container restarts in a loop.
 */
export async function waitForClickHouse(client: ClickHouseClient, url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const result = await client.ping()
      if (result.success) return
      last = result.error
    } catch (err) {
      last = err
    }
    await sleep(2_000)
  }
  const host = parseClickHouseUrl(url).url
  throw new ClickHouseUnavailableError(
    `ClickHouse did not answer at ${host} within ${Math.round(timeoutMs / 1000)}s (${String(last)}). ` +
      'If the clickhouse container keeps restarting on an x86 server, its CPU probably lacks AVX2: ' +
      'the official ClickHouse image needs x86-64-v3 (most CPUs since 2015; arm64 also works). ' +
      'See https://docs.octadash.com/self-hosting#requirements.',
  )
}

/**
 * Creates the database if needed and applies pending migrations. Callers hold
 * a lock (see migrateAll in the worker) so two processes never run it at once.
 */
export async function migrateClickHouse(
  url: string,
  options: { timeoutMs?: number; migrations?: ClickHouseMigration[] } = {},
): Promise<ClickHouseMigrationResult[]> {
  const { database } = parseClickHouseUrl(url)
  const admin = createClickHouse(url, { database: 'default', applicationName: 'octadash-migrate' })
  try {
    await waitForClickHouse(admin, url, options.timeoutMs ?? 120_000)
    await admin.command({ query: `CREATE DATABASE IF NOT EXISTS ${database}` })
  } finally {
    await admin.close()
  }

  const client = createClickHouse(url, { applicationName: 'octadash-migrate' })
  try {
    await client.command({
      query: `CREATE TABLE IF NOT EXISTS octadash_migration (
        name String,
        applied_at DateTime64(3, 'UTC') DEFAULT now64(3)
      ) ENGINE = ReplacingMergeTree ORDER BY name`,
    })
    const applied = new Set(
      (
        await (
          await client.query({
            query: 'SELECT name FROM octadash_migration FINAL',
            format: 'JSONEachRow',
          })
        ).json<{ name: string }>()
      ).map((row) => row.name),
    )
    const results: ClickHouseMigrationResult[] = []
    for (const migration of options.migrations ?? clickhouseMigrations) {
      if (applied.has(migration.name)) continue
      for (const statement of migration.statements) {
        await client.command({ query: statement })
      }
      await client.insert({
        table: 'octadash_migration',
        values: [{ name: migration.name }],
        format: 'JSONEachRow',
      })
      results.push({ migrationName: migration.name, status: 'Success' })
    }
    return results
  } finally {
    await client.close()
  }
}
