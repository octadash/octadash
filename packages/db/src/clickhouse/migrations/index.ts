import type { ClickHouseMigration } from '../migrate'
import { migration as m0001 } from './0001_events'
import { migration as m0002 } from './0002_uptime_checks'
import { migration as m0003 } from './0003_events_source'
import { migration as m0004 } from './0004_events_context'
import { migration as m0005 } from './0005_errors'
import { migration as m0006 } from './0006_logs'
import { migration as m0007 } from './0007_errors_trace'
import { migration as m0008 } from './0008_money'
import { migration as m0009 } from './0009_received'
import { migration as m0010 } from './0010_spans'
import { migration as m0011 } from './0011_metrics'
import { migration as m0012 } from './0012_errors_event'
import { migration as m0013 } from './0013_uptime_facts'
import { migration as m0014 } from './0014_errors_retention'
import { migration as m0015 } from './0015_events_retention'

/**
 * ClickHouse migrations, applied in this order. Imported statically so they
 * survive bundling. Add new ones at the end; never edit a released one. Each
 * statement must be safe to run twice (IF NOT EXISTS), because ClickHouse has
 * no transactions: a crash halfway reruns the whole migration.
 */
export const clickhouseMigrations: ClickHouseMigration[] = [
  m0001,
  m0002,
  m0003,
  m0004,
  m0005,
  m0006,
  m0007,
  m0008,
  m0009,
  m0010,
  m0011,
  m0012,
  m0013,
  m0014,
  m0015,
]
