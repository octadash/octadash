import type { ColumnType, Generated } from 'kysely'

/**
 * Database schema, table by table. Every table that holds customer data carries
 * `org_id` (and `project_id` where it belongs to a product) so the same schema
 * serves a single self-hosted install and a multi-tenant cloud
 * (see docs/architecture.md).
 *
 * `auth_*` tables belong to Better Auth (camelCase columns); only the columns
 * Octadash reads directly are typed here.
 */
export interface Database {
  octadash_instance: OctadashInstanceTable
  project: ProjectTable
  project_key: ProjectKeyTable
  project_area: ProjectAreaTable
  monitor: MonitorTable
  channel: ChannelTable
  alert_rule: AlertRuleTable
  incident: IncidentTable
  notification: NotificationTable
  product_group: ProductGroupTable
  product_group_member: ProductGroupMemberTable
  auth_user: AuthUserTable
  auth_organization: AuthOrganizationTable
  auth_member: AuthMemberTable
  auth_invitation: AuthInvitationTable
}

type CreatedAt = ColumnType<Date, Date | undefined, never>

export interface OctadashInstanceTable {
  id: Generated<string>
  created_at: CreatedAt
}

export interface ProjectTable {
  id: string
  org_id: string
  ingest_id: ColumnType<string, never, never>
  name: string
  slug: string
  /** Legacy address from the diagnosis era. Read once by the uptime step, then dropped. */
  url: ColumnType<string | null, never, never>
  created_at: CreatedAt
  updated_at: ColumnType<Date, Date | undefined, Date>
}

export interface ProjectKeyTable {
  id: string
  org_id: string
  project_id: string
  public_key: string
  label: Generated<string>
  created_at: CreatedAt
  revoked_at: Date | null
}

export type ProjectAreaState = 'set_up' | 'dismissed'

export interface ProjectAreaTable {
  org_id: string
  project_id: string
  area: string
  state: ProjectAreaState
  updated_at: ColumnType<Date, Date | undefined, Date>
}

export type MonitorKind = 'site' | 'health' | 'heartbeat'
export type MonitorStatus = 'unknown' | 'up' | 'down'

export interface MonitorTable {
  id: string
  org_id: string
  project_id: string
  name: string
  kind: MonitorKind
  url: string | null
  interval_seconds: Generated<number>
  grace_seconds: Generated<number>
  heartbeat_token: string | null
  paused: Generated<boolean>
  status: Generated<MonitorStatus>
  status_since: Date | null
  created_at: CreatedAt
  updated_at: ColumnType<Date, Date | undefined, Date>
}

export type AlertLevel = 'emergency' | 'signal'
type Json = ColumnType<
  Record<string, unknown>,
  Record<string, unknown> | string | undefined,
  Record<string, unknown> | string
>

export interface ChannelTable {
  id: string
  org_id: string
  integration: string
  name: string
  locale: Generated<string>
  /** Settings without secrets. */
  config: Json
  /** Each secret key encrypted with OCTADASH_SECRET. */
  secrets: Json
  enabled: Generated<boolean>
  created_at: CreatedAt
  updated_at: ColumnType<Date, Date | undefined, Date>
}

export interface AlertRuleTable {
  id: string
  org_id: string
  project_id: string | null
  kind: string
  level: AlertLevel | 'off'
  params: Json
  /** Null sends to every enabled channel of the organization. */
  channel_ids: string[] | null
  updated_at: ColumnType<Date, Date | undefined, Date>
}

export interface IncidentTable {
  id: string
  org_id: string
  project_id: string
  monitor_id: string | null
  parent_id: string | null
  kind: string
  level: AlertLevel
  dedupe_key: string
  data: Json
  channel_ids: string[] | null
  started_at: Date
  notify_after: Date
  resolved_at: Date | null
  acknowledged_at: Date | null
  /** The user who took the incident. */
  acknowledged_by: string | null
  notified_open_at: Date | null
  notified_resolve_at: Date | null
}

export interface NotificationTable {
  id: string
  org_id: string
  channel_id: string | null
  incident_ids: string[]
  event: 'open' | 'resolve'
  ok: boolean
  error: string | null
  sent_at: CreatedAt
}

export interface AuthUserTable {
  id: string
  name: string
  email: string
}

export interface AuthOrganizationTable {
  id: string
  name: string
  slug: string
}

export interface AuthMemberTable {
  id: string
  organizationId: string
  userId: string
  role: string
}

export interface AuthInvitationTable {
  id: string
  organizationId: string
  email: string
  role: string | null
  status: string
  expiresAt: Date
  inviterId: string
  createdAt: Date
}

export interface ProductGroupTable {
  id: string
  org_id: string
  name: string
  slug: string
  created_at: CreatedAt
  updated_at: ColumnType<Date, Date | undefined, Date>
}

export interface ProductGroupMemberTable {
  group_id: string
  project_id: string
}
