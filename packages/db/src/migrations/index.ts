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
import * as m0010 from './0010_sources'
import * as m0011 from './0011_source_visitors'
import * as m0012 from './0012_organization_settings'
import * as m0013 from './0013_get_started'
import * as m0014 from './0014_members'
import * as m0015 from './0015_monitor_schedule'
import * as m0016 from './0016_incident_events'
import * as m0017 from './0017_product_settings'
import * as m0018 from './0018_tv_links'
import * as m0019 from './0019_error_issues'
import * as m0020 from './0020_error_issue_last_seen'
import * as m0021 from './0021_product_usage'
import * as m0022 from './0022_logs'
import * as m0023 from './0023_money'
import * as m0024 from './0024_costs'
import * as m0025 from './0025_cost_split_history'
import * as m0026 from './0026_monitor_source'

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
  '0010_sources': m0010,
  '0011_source_visitors': m0011,
  '0012_organization_settings': m0012,
  '0013_get_started': m0013,
  '0014_members': m0014,
  '0015_monitor_schedule': m0015,
  '0016_incident_events': m0016,
  '0017_product_settings': m0017,
  '0018_tv_links': m0018,
  '0019_error_issues': m0019,
  '0020_error_issue_last_seen': m0020,
  '0021_product_usage': m0021,
  '0022_logs': m0022,
  '0023_money': m0023,
  '0024_costs': m0024,
  '0025_cost_split_history': m0025,
  '0026_monitor_source': m0026,
}
