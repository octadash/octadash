import type { Logger } from '@octadash/core'
import { type ClickHouseClient, type EventRow, insertEvents } from '@octadash/db'
import { type Redis, startConsumer } from '@octadash/queue'

/**
 * Moves what the ingest queued into ClickHouse: one consumer per stream. More
 * workers can run side by side; the consumer group splits the entries.
 */
export function startWriters(valkey: Redis, clickhouse: ClickHouseClient, log: Logger) {
  const consumers = [
    startConsumer(
      valkey,
      'events',
      async (rows, token) => {
        await insertEvents(clickhouse, rows as EventRow[], token)
        log.debug({ rows: rows.length }, 'events written')
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
