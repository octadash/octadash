import { sql } from 'kysely'
import type { AnyDb } from './client'

/**
 * Daily range partitions for high-volume tables (events, errors, logs, checks).
 *
 * Why daily and why managed here: dropping a whole partition is how retention
 * works, it costs nothing compared to DELETE, and doing it in our own code keeps
 * Octadash free of extensions such as pg_partman, so it runs on any Postgres
 * (Docker, Neon, Supabase, RDS).
 */

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/

function assertIdentifier(name: string): void {
  if (!IDENTIFIER.test(name)) throw new Error(`Invalid table name: ${name}`)
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000)
}

function yyyymmdd(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll('-', '')
}

/** Name of the partition holding `date`, e.g. events_p20261127. */
export function dailyPartitionName(table: string, date: Date): string {
  assertIdentifier(table)
  return `${table}_p${yyyymmdd(date)}`
}

/** Half-open UTC range [from, to) covered by the partition of `date`. */
export function dailyPartitionRange(date: Date): { from: Date; to: Date } {
  const from = startOfUtcDay(date)
  return { from, to: addDays(from, 1) }
}

/** Days that must have a partition: today plus `daysAhead` days. */
export function partitionDays(today: Date, daysAhead: number): Date[] {
  const start = startOfUtcDay(today)
  return Array.from({ length: daysAhead + 1 }, (_, i) => addDays(start, i))
}

/** Parses the day out of a partition name produced by dailyPartitionName. */
export function partitionDay(table: string, partitionName: string): Date | null {
  const match = new RegExp(`^${table}_p(\\d{4})(\\d{2})(\\d{2})$`).exec(partitionName)
  if (!match) return null
  const [, y, m, d] = match
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
}

/** Creates any missing partition from today up to `daysAhead` days ahead. */
export async function ensureDailyPartitions(
  db: AnyDb,
  table: string,
  options: { today?: Date; daysAhead?: number } = {},
): Promise<string[]> {
  assertIdentifier(table)
  const created: string[] = []
  for (const day of partitionDays(options.today ?? new Date(), options.daysAhead ?? 3)) {
    const name = dailyPartitionName(table, day)
    const { from, to } = dailyPartitionRange(day)
    await sql`create table if not exists ${sql.id(name)} partition of ${sql.id(table)}
      for values from (${sql.lit(from.toISOString())}) to (${sql.lit(to.toISOString())})`.execute(
      db,
    )
    created.push(name)
  }
  return created
}

/** Drops partitions whose whole day is older than `retentionDays`. Returns the dropped names. */
export async function dropExpiredPartitions(
  db: AnyDb,
  table: string,
  retentionDays: number,
  today: Date = new Date(),
): Promise<string[]> {
  assertIdentifier(table)
  const cutoff = addDays(startOfUtcDay(today), -retentionDays)
  const result = await sql<{ name: string }>`
    select c.relname as name
    from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    where p.relname = ${table}`.execute(db)
  const dropped: string[] = []
  for (const { name } of result.rows) {
    const day = partitionDay(table, name)
    if (day && day < cutoff) {
      await sql`drop table if exists ${sql.id(name)}`.execute(db)
      dropped.push(name)
    }
  }
  return dropped
}
