import type { ClickHouseClient } from '@clickhouse/client'

/**
 * Shortens what a product keeps in a table whose rows carry their retention
 * (`retention_days`) outside the partition key: rows older than `days` are
 * deleted now, and the newer ones take the shorter retention, so the TTL
 * removes them on time instead of on the date they arrived with. ClickHouse
 * runs both in the background.
 */
export async function trimRetention(
  client: ClickHouseClient,
  table: 'errors' | 'events',
  orgId: string,
  projectId: string,
  days: number,
) {
  const query_params = { org: orgId, project: projectId, days }
  await client.command({
    query: `
      ALTER TABLE ${table} DELETE
      WHERE org_id = {org:UUID} AND project_id = {project:UUID}
        AND timestamp < now() - toIntervalDay({days:UInt16})`,
    query_params,
  })
  await client.command({
    query: `
      ALTER TABLE ${table} UPDATE retention_days = {days:UInt16}
      WHERE org_id = {org:UUID} AND project_id = {project:UUID}
        AND retention_days > {days:UInt16}`,
    query_params,
  })
}
