import type { ClickHouseMigration } from '../migrate'
import { migration as m0001 } from './0001_events'
import { migration as m0002 } from './0002_uptime_checks'
import { migration as m0003 } from './0003_events_source'

/**
 * ClickHouse migrations, applied in this order. Imported statically so they
 * survive bundling. Add new ones at the end; never edit a released one. Each
 * statement must be safe to run twice (IF NOT EXISTS), because ClickHouse has
 * no transactions: a crash halfway reruns the whole migration.
 */
export const clickhouseMigrations: ClickHouseMigration[] = [m0001, m0002, m0003]
