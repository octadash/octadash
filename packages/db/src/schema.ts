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
  organization_settings: OrganizationSettingsTable
  project: ProjectTable
  project_slug_alias: ProjectSlugAliasTable
  source: SourceTable
  source_key: SourceKeyTable
  project_area: ProjectAreaTable
  monitor: MonitorTable
  channel: ChannelTable
  alert_rule: AlertRuleTable
  incident: IncidentTable
  incident_event: IncidentEventTable
  notification: NotificationTable
  product_group: ProductGroupTable
  product_group_member: ProductGroupMemberTable
  auth_user: AuthUserTable
  auth_organization: AuthOrganizationTable
  auth_member: AuthMemberTable
  auth_invitation: AuthInvitationTable
  member_seen: MemberSeenTable
  invitation_email: InvitationEmailTable
}

type CreatedAt = ColumnType<Date, Date | undefined, never>

export type WatcherStatus = 'unknown' | 'ok' | 'failing'

export interface OctadashInstanceTable {
  id: Generated<string>
  created_at: CreatedAt
  /** Encrypted ping URL of the outside watcher (Healthchecks.io or similar). */
  watcher_url: ColumnType<string | null, string | null | undefined, string | null>
  watcher_status: ColumnType<WatcherStatus, WatcherStatus | undefined, WatcherStatus>
  watcher_checked_at: ColumnType<Date | null, Date | null | undefined, Date | null>
  watcher_error: ColumnType<string | null, string | null | undefined, string | null>
}

/** An old address of a product, kept after a rename so links keep working. */
export interface ProjectSlugAliasTable {
  org_id: string
  slug: string
  project_id: string
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

export interface OrganizationSettingsTable {
  org_id: string
  /** ISO 4217, upper case: "BRL", "USD". */
  currency: ColumnType<string, string | undefined, string>
  /** IANA: "America/Sao_Paulo". */
  time_zone: ColumnType<string, string | undefined, string>
  /** When someone hid the "Get started" list. */
  get_started_hidden_at: ColumnType<Date | null, Date | null | undefined, Date | null>
  updated_at: ColumnType<Date, Date | undefined, Date>
}

export interface SourceTable {
  id: string
  org_id: string
  project_id: string
  /** "Site", "API", "Worker". */
  name: string
  /** "nextjs", "dotnet", "node"... picks the install instructions. */
  platform: string
  /** The areas this source feeds; shown on each area's setup. */
  areas: ColumnType<string[], string[] | undefined, string[]>
  visitor_mode: ColumnType<VisitorMode, VisitorMode | undefined, VisitorMode>
  created_at: CreatedAt
  updated_at: ColumnType<Date, Date | undefined, Date>
}

/**
 * How Traffic tells visitors apart. `daily`: a hash of the day, with nothing
 * in the browser. `persistent`: a random id the browser script keeps, so
 * returning visitors count once.
 */
export type VisitorMode = 'daily' | 'persistent'

export interface SourceKeyTable {
  id: string
  org_id: string
  project_id: string
  /** Null for a product key from before sources. */
  source_id: ColumnType<string | null, string | null | undefined, string | null>
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
  /** Events not stored because the area is dismissed. */
  discarded_events: ColumnType<string, never, string | number>
  discarded_at: ColumnType<Date | null, never, Date | null>
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
  /** Heartbeats: five-field cron in the organization's time zone; null means every interval. */
  schedule: ColumnType<string | null, string | null | undefined, string | null>
  timeout_seconds: Generated<number>
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

export type IncidentEventKind = 'took' | 'note' | 'closed'

export interface IncidentEventTable {
  id: string
  org_id: string
  incident_id: string
  user_id: string | null
  kind: IncidentEventKind
  body: string | null
  at: ColumnType<Date, Date | undefined, never>
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

export interface MemberSeenTable {
  org_id: string
  user_id: string
  seen_at: Date
}

export interface InvitationEmailTable {
  invitation_id: string
  org_id: string
  /** The email channel it went through. */
  channel_id: string | null
  sent_at: Date | null
  /** Why it did not go out, as the provider said. */
  error: string | null
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
