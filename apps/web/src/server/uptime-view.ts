import { type ClickHouseClient, type MonitorStats, monitorStats } from '@octadash/db'
import { getTranslations } from 'next-intl/server'
import type { MonitorDialogLabels } from '@/components/monitor-dialog'
import { durationLabel, GRACES, INTERVALS } from '@/lib/monitors'

/** Labels and choices for the monitor dialog, in the reader's language. */
export async function monitorDialogProps(mode: 'add' | 'edit') {
  const t = await getTranslations('uptime')
  const common = await getTranslations('common')
  const duration = (seconds: number) => durationLabel(seconds, (key, values) => t(key, values))
  const labels: MonitorDialogLabels = {
    title: mode === 'add' ? t('add') : t('edit'),
    intro: t('intro'),
    name: t('name'),
    kind: t('kind'),
    kinds: {
      site: { label: t('kindSite'), hint: t('kindSiteHint') },
      health: { label: t('kindHealth'), hint: t('kindHealthHint') },
      heartbeat: { label: t('kindHeartbeat'), hint: t('kindHeartbeatHint') },
    },
    url: t('url'),
    interval: t('interval'),
    intervalHeartbeat: t('intervalHeartbeat'),
    grace: t('grace'),
    graceHint: t('graceHint'),
    wakeTitle: t('wakeTitle'),
    wakeBody: t('wakeBody'),
    cancel: common('cancel'),
    submit: mode === 'add' ? t('create') : t('save'),
  }
  return {
    labels,
    intervals: INTERVALS.map((value) => ({ value, label: duration(value) })),
    graces: GRACES.map((value) => ({ value, label: value === 0 ? t('none') : duration(value) })),
  }
}

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
