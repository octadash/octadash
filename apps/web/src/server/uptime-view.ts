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

/** "99.95%" (or "99,95%") with two decimals only when they matter. */
export function formatUptime(ratio: number | null, locale = 'en'): string {
  if (ratio === null) return '–'
  const percent = ratio * 100
  const digits = percent === 100 || percent === 0 ? 0 : percent >= 99 ? 2 : 1
  // Truncated, not rounded: 99.996% must not read as 100%.
  const factor = 10 ** (digits + 2)
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.floor(ratio * factor) / factor)
}

export { type ProductUptime, productUptime } from '@/lib/monitors'
