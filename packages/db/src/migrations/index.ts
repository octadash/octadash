import type { Migration } from 'kysely/migration'
import * as m0001 from './0001_instance'
import * as m0002 from './0002_projects'
import * as m0003 from './0003_diagnosis'
import * as m0004 from './0004_drop_diagnosis'
import * as m0005 from './0005_project_area'
import * as m0006 from './0006_monitors'
import * as m0007 from './0007_alerts'
import * as m0008 from './0008_groups'
import * as m0009 from './0009_watcher'

/**
 * Migrations are imported statically (not read from disk) so they survive
 * bundling into a single file. Add new ones at the end; never edit a released one.
 */
export const migrations: Record<string, Migration> = {
  '0001_instance': m0001,
  '0002_projects': m0002,
  '0003_diagnosis': m0003,
  '0004_drop_diagnosis': m0004,
  '0005_project_area': m0005,
  '0006_monitors': m0006,
  '0007_alerts': m0007,
  '0008_groups': m0008,
  '0009_watcher': m0009,
}
