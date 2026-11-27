import type { Migration } from 'kysely/migration'
import * as m0001 from './0001_instance'
import * as m0002 from './0002_projects'

/**
 * Migrations are imported statically (not read from disk) so they survive
 * bundling into a single file. Add new ones at the end; never edit a released one.
 */
export const migrations: Record<string, Migration> = {
  '0001_instance': m0001,
  '0002_projects': m0002,
}
