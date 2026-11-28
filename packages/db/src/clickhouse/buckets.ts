import type { ClickHouseClient } from '@clickhouse/client'
import { toClickHouseTime } from './events'

/** Charts cut time in hours (a day or a week) or days (a month and longer). */
export type Bucket = 'hour' | 'day'

/** Times come back as ISO 8601 in UTC, whatever zone a bucket was cut in. */
export const ISO_TIMES = { date_time_output_format: 'iso' } as const

/** Start of a bucket in a time zone, and the step from one bucket to the next. */
export function bucketSql(bucket: Bucket) {
  return {
    start: bucket === 'hour' ? 'toStartOfHour' : 'toStartOfDay',
    step: bucket === 'hour' ? 'INTERVAL 1 HOUR' : 'INTERVAL 1 DAY',
  }
}

/**
 * Every bucket start of a period, cut in its time zone, so days follow local
 * midnight and change length with daylight saving time.
 */
export async function bucketStarts(
  client: ClickHouseClient,
  period: { from: Date; to: Date; timeZone?: string },
  bucket: Bucket,
): Promise<Date[]> {
  const { start, step } = bucketSql(bucket)
  const first = `${start}(toDateTime({from:DateTime64(3, 'UTC')}, 'UTC'), {tz:String})`
  const result = await client.query({
    query: `
      SELECT ${first} AS at
      ORDER BY at
      WITH FILL FROM ${first} TO toDateTime({to:DateTime64(3, 'UTC')}, 'UTC') STEP ${step}`,
    query_params: {
      from: toClickHouseTime(period.from),
      to: toClickHouseTime(period.to),
      tz: period.timeZone ?? 'UTC',
    },
    clickhouse_settings: ISO_TIMES,
    format: 'JSONEachRow',
  })
  return (await result.json<{ at: string }>()).map((row) => new Date(row.at))
}
