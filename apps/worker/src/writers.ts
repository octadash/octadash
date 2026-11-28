import type { Logger } from '@octadash/core'
import {
  AREA_RETENTION,
  areaOfReceived,
  type ClickHouseClient,
  type EventRow,
  insertEvents,
  insertMetrics,
  insertReceived,
  insertSpans,
  type QueuedError,
  type QueuedLog,
  type QueuedMetric,
  type QueuedReceived,
  type QueuedSpan,
} from '@octadash/db'
import { type Redis, startConsumer } from '@octadash/queue'
import { type ErrorWriterDeps, writeErrors } from './errors'
import { createLogWriter, type LogWriterDeps } from './logs'
import { cachedRetention } from './retention'
import type { EventRouter } from './routing'

/**
 * Moves what the ingest queued into ClickHouse: one consumer per stream. More
 * workers can run side by side; the consumer group splits the entries.
 */
export function startWriters(
  valkey: Redis,
  clickhouse: ClickHouseClient,
  router: EventRouter,
  errors: Omit<ErrorWriterDeps, 'router' | 'log' | 'retentionOf'> & {
    loadRetention(projectIds: string[]): Promise<Map<string, number>>
  },
  logs: Omit<LogWriterDeps, 'router' | 'log'>,
  log: Logger,
  retention: { receivedDays: number; traceDays: number; metricDays: number },
) {
  const writeLogs = createLogWriter({ ...logs, router, log })
  const errorDeps: ErrorWriterDeps = {
    ...errors,
    retentionOf: cachedRetention(errors.loadRetention, AREA_RETENTION.errors.defaultDays),
    router,
    log,
  }
  const consumers = [
    startConsumer(
      valkey,
      'events',
      async (rows, token) => {
        // A batch retried after a failed insert counts its discarded events again;
        // the count is a hint on the card, not billing.
        const kept = await router.route(rows as EventRow[])
        await insertEvents(clickhouse, kept, token)
        log.debug({ rows: kept.length, discarded: rows.length - kept.length }, 'events written')
      },
      { log },
    ),
    startConsumer(
      valkey,
      'errors',
      (rows, token) => writeErrors(rows as QueuedError[], token, errorDeps),
      { log },
    ),
    startConsumer(valkey, 'logs', (rows, token) => writeLogs(rows as QueuedLog[], token), { log }),
    startConsumer(
      valkey,
      'received',
      async (rows, token) => {
        const kept = await router.route(rows as QueuedReceived[], (row) => areaOfReceived(row.kind))
        await insertReceived(
          clickhouse,
          kept.map((row) => ({ ...row, retention_days: retention.receivedDays })),
          token,
        )
        log.debug({ rows: kept.length, discarded: rows.length - kept.length }, 'received written')
      },
      { log },
    ),
    startConsumer(
      valkey,
      'spans',
      async (rows, token) => {
        // Spans belong to no area yet, so no product can have turned them off.
        await insertSpans(
          clickhouse,
          (rows as QueuedSpan[]).map((row) => ({ ...row, retention_days: retention.traceDays })),
          token,
        )
        log.debug({ rows: rows.length }, 'spans written')
      },
      { log },
    ),
    startConsumer(
      valkey,
      'metrics',
      async (rows, token) => {
        // Metrics belong to no area yet, so no product can have turned them off.
        await insertMetrics(
          clickhouse,
          (rows as QueuedMetric[]).map((row) => ({ ...row, retention_days: retention.metricDays })),
          token,
        )
        log.debug({ rows: rows.length }, 'metrics written')
      },
      { log },
    ),
  ]
  return {
    async stop() {
      await Promise.all(consumers.map((consumer) => consumer.stop()))
    },
  }
}
