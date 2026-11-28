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
  tv_link: TvLinkTable
  error_issue: ErrorIssueTable
  key_event: KeyEventTable
  funnel: FunnelTable
  log_search: LogSearchTable
  connection: ConnectionTable
  connection_project: ConnectionProjectTable
  fx_rate: FxRateTable
  cost_share: CostShareTable
  cost_split_history: CostSplitHistoryTable
  fixed_cost: FixedCostTable
  cost_day: CostDayTable
  cost_hour: CostHourTable
  cost_budget: CostBudgetTable
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

export type IssueStatus = 'unresolved' | 'resolved' | 'ignored'

/** When an ignored issue comes back: after `count` more events, `people` more people, or at `until` (ms). */
export interface IgnoreUntil {
  count?: number
  people?: number
  until?: number
}

/** The same error in the same place; each occurrence is a row in ClickHouse. */
export interface ErrorIssueTable {
  id: string
  org_id: string
  project_id: string
  fingerprint: string
  type: string
  value: string
  culprit: string
  platform: string
  level: string
  handled: boolean
  first_seen: Date
  last_seen: Date
  first_release: string
  last_release: string
  times_seen: ColumnType<string, number | string | undefined, number | string>
  status: ColumnType<IssueStatus, IssueStatus | undefined, IssueStatus>
  status_at: Date | null
  status_by: string | null
  resolved_release: string | null
  ignore_until: Json | null
  ignored_times_seen: ColumnType<
    string | null,
    number | string | null | undefined,
    number | string | null
  >
  regressed_at: Date | null
  acknowledged_by: string | null
  acknowledged_at: Date | null
}

/** An event a product cannot live without; see migration 0021. */
export interface KeyEventTable {
  project_id: string
  org_id: string
  event: string
  created_by: string | null
  created_at: CreatedAt
}

/** Steps in order, counted per person within `window_days`. */
export interface FunnelTable {
  id: string
  org_id: string
  project_id: string
  name: string
  steps: Json
  window_days: ColumnType<number, number | undefined, number>
  created_by: string | null
  created_at: CreatedAt
  updated_at: ColumnType<Date, Date | undefined, Date>
}

/** A saved Logs search; with `alert` on it is a "Log alert" rule. */
export interface LogSearchTable {
  id: string
  org_id: string
  name: string
  query: string
  alert: ColumnType<boolean, boolean | undefined, boolean>
  /** When the alert was turned on: lines before it never fire. */
  alert_since: Date | null
  created_by: string | null
  created_at: CreatedAt
  updated_at: ColumnType<Date, Date | undefined, Date>
}

/** A gateway account Money (and later Costs) reads from. */
export interface ConnectionTable {
  id: string
  org_id: string
  /** stripe, asaas, paddle. */
  integration: string
  name: string
  /** JSON of { key, webhookSecret? }, each value encrypted with OCTADASH_SECRET. */
  secrets: string
  /** The key's last characters, to tell keys apart without showing them. */
  key_hint: Generated<string>
  /** The random part of /hooks/<integration>/<token>. */
  webhook_token: string
  /** importing, ok or failing. */
  status: Generated<string>
  last_error: string | null
  imported_at: Date | null
  synced_at: Date | null
  subscriptions_synced_at: Date | null
  /** Last webhook that arrived with a good signature. */
  webhook_at: Date | null
  /** Costs: how the part no product claims is divided (equal, traffic, percent). */
  split: Generated<string>
  created_at: CreatedAt
  updated_at: ColumnType<Date, Date | undefined, Date>
}

export interface ConnectionProjectTable {
  connection_id: string
  project_id: string
  org_id: string
  /** all, products or metadata. */
  mode: Generated<string>
  values: ColumnType<string[], string[] | undefined, string[]>
  created_at: CreatedAt
}

/** A product's part of a cost connection: the provider's tags it claims, and a share of the rest. */
export interface CostShareTable {
  connection_id: string
  project_id: string
  org_id: string
  tags: ColumnType<string[], string[] | undefined, string[]>
  rest: Generated<boolean>
  percent: number | null
  created_at: CreatedAt
}

/** A connection's whole division from a day on, kept at every change. */
export interface CostSplitHistoryTable {
  connection_id: string
  org_id: string
  /** "2026-11-28", in the organization's time zone. */
  valid_from: ColumnType<string, string, string>
  split: string
  shares: ColumnType<unknown, string, string>
}

/** A fixed bill: amount in minor units every month or year. */
export interface FixedCostTable {
  connection_id: string
  org_id: string
  amount: ColumnType<number, number, number>
  currency: string
  /** month or year. */
  every: Generated<string>
  starts_on: ColumnType<string, string, string>
}

/** A provider's charge for a day, tag and line item, in minor units with fractions. */
export interface CostDayTable {
  connection_id: string
  org_id: string
  day: ColumnType<string, string, string>
  tag: Generated<string>
  line_item: Generated<string>
  amount: number
  currency: string
  updated_at: ColumnType<Date, Date | undefined, Date>
}

/** Spend in an hour and tag, for "Cost runaway". */
export interface CostHourTable {
  connection_id: string
  org_id: string
  hour: Date
  tag: Generated<string>
  amount: number
  currency: string
}

/** A product's monthly budget, in the organization's currency (minor units). */
export interface CostBudgetTable {
  project_id: string
  org_id: string
  amount: ColumnType<number, number, number>
  warn: Generated<number>
  updated_at: ColumnType<Date, Date | undefined, Date>
}

export interface FxRateTable {
  day: ColumnType<string, string, string>
  currency: string
  per_usd: number
}

/** A private TV link; only the token's hash is stored. */
export interface TvLinkTable {
  id: string
  org_id: string
  token_hash: string
  settings: Json
  created_by: string | null
  created_at: CreatedAt
  last_opened_at: Date | null
  stopped_at: Date | null
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
  /** Days the area keeps its data in this product; null is the area's default. */
  retention_days: ColumnType<number | null, number | null | undefined, number | null>
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
  /** The source of the product this monitor checks ("Docs"); null when not linked. */
  source_id: ColumnType<string | null, string | null | undefined, string | null>
  /** When someone closed the "same server as Octadash" notice for this monitor. */
  same_server_dismissed_at: ColumnType<Date | null, Date | null | undefined, Date | null>
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
