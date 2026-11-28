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
