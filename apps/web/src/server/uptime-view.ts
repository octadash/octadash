import { type ClickHouseClient, type MonitorStats, monitorStats } from '@octadash/db'

/** Uptime numbers per monitor. A ClickHouse failure shows empty numbers, not an error page. */
export async function safeMonitorStats(
  clickhouse: ClickHouseClient,
  orgId: string,
  monitorIds: string[],
): Promise<Map<string, MonitorStats>> {
  try {
    return await monitorStats(clickhouse, orgId, monitorIds)
  } catch {
    return new Map()
  }
}

/** "99.95%" with two decimals only when they matter. */
export function formatUptime(ratio: number | null): string {
  if (ratio === null) return '–'
  const percent = ratio * 100
  if (percent === 100 || percent === 0) return `${percent}%`
  return `${percent.toFixed(percent >= 99 ? 2 : 1)}%`
}

export { type ProductUptime, productUptime } from '@/lib/monitors'
