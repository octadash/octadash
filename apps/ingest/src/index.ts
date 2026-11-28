import { serve } from '@hono/node-server'
import { createLogger, ingestEnvSchema, parseEnv } from '@octadash/core'
import { createDb, findHeartbeatMonitor, findIngestKey } from '@octadash/db'
import { createValkey, ValkeyHeartbeats, ValkeySalts, ValkeySink } from '@octadash/queue'
import { storageFromEnv } from '@octadash/storage'
import { createApp } from './app'
import { cachedHeartbeatResolver, cachedResolver } from './keys'

const env = parseEnv(ingestEnvSchema)
const log = createLogger('ingest', env.LOG_LEVEL)

// Postgres is only read to check keys and heartbeat tokens, and the answers are cached.
const { db, pool } = createDb(env.DATABASE_URL, { max: 3, applicationName: 'octadash-ingest' })
const valkey = createValkey(env.VALKEY_URL, { name: 'octadash-ingest', failFast: true })
valkey.on('error', (err) => log.warn({ err: err.message }, 'valkey connection error'))
const sink = new ValkeySink(valkey, { maxPending: env.OCTADASH_INGEST_QUEUE_MAX })
const files = storageFromEnv(env)
if (!files) log.warn('no file storage set (STORAGE_*): items over 1 MB are counted, not kept')

const app = createApp({
  sink,
  keys: cachedResolver((publicKey) => findIngestKey(db, publicKey)),
  heartbeats: {
    resolver: cachedHeartbeatResolver((token) => findHeartbeatMonitor(db, token)),
    store: new ValkeyHeartbeats(valkey),
  },
  salts: new ValkeySalts(valkey),
  files,
  onError: (err) => log.error({ err }, 'request failed'),
})

const server = serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  log.info({ port: info.port }, 'ingest listening')
})

function shutdown(signal: string) {
  log.info({ signal }, 'shutting down')
  server.close(async () => {
    sink.stop()
    valkey.disconnect()
    await pool.end()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
