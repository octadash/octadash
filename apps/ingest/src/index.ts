import { serve } from '@hono/node-server'
import { createLogger, ingestEnvSchema, parseEnv } from '@octadash/core'
import { createApp } from './app'

const env = parseEnv(ingestEnvSchema)
const log = createLogger('ingest', env.LOG_LEVEL)

const server = serve({ fetch: createApp().fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  log.info({ port: info.port }, 'ingest listening')
})

function shutdown(signal: string) {
  log.info({ signal }, 'shutting down')
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
