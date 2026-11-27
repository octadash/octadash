import type { ColumnType, Generated } from 'kysely'

/**
 * Database schema, table by table. Every table that holds customer data carries
 * `org_id` and `project_id` so the same schema serves a single self-hosted install
 * and a multi-tenant cloud (see docs/adr/0001-stack.md).
 */
export interface Database {
  octadash_instance: OctadashInstanceTable
}

export interface OctadashInstanceTable {
  id: Generated<string>
  created_at: ColumnType<Date, never, never>
}
