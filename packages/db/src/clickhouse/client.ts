import { type ClickHouseClient, ClickHouseLogLevel, createClient } from '@clickhouse/client'

/**
 * ClickHouse connection from one URL, e.g. http://octadash:pass@clickhouse:8123/octadash.
 * The path is the database. Talks HTTP only, so it bundles into a single file.
 */
export interface ClickHouseConfig {
  url: string
  username: string
  password: string
  database: string
}

export function parseClickHouseUrl(input: string): ClickHouseConfig {
  const url = new URL(input)
  const database = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, '')) || 'octadash'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) {
    throw new Error(`Invalid ClickHouse database name: ${database}`)
  }
  const config = {
    url: `${url.protocol}//${url.host}`,
    username: decodeURIComponent(url.username) || 'default',
    password: decodeURIComponent(url.password),
    database,
  }
  return config
}

export interface CreateClickHouseOptions {
  /** Shown in system.processes and the query log. */
  applicationName?: string
  /** Connect to another database than the URL's (the migrator uses `default` to create it). */
  database?: string
}

export function createClickHouse(url: string, options: CreateClickHouseOptions = {}) {
  const config = parseClickHouseUrl(url)
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: options.database ?? config.database,
    application: options.applicationName ?? 'octadash',
    request_timeout: 30_000,
    // The client prints plain-text warnings to stdout; Octadash logs failures itself, as JSON.
    log: { level: ClickHouseLogLevel.OFF },
    clickhouse_settings: {
      // Rows carry timestamps as "2026-11-28 12:00:00.000" in UTC.
      date_time_input_format: 'best_effort',
    },
  })
}

export type { ClickHouseClient }
