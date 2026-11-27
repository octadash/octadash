import { OCTADASH_VERSION } from '@octadash/core'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

/**
 * The ingest service only receives data. It speaks several wire formats so
 * existing SDKs work by changing one URL:
 *   - Sentry envelopes      /api/:projectId/envelope/          (module 4)
 *   - PostHog capture       /e/, /i/v0/e/, /batch/, /capture/   (modules 3, 5, 7)
 *   - OpenTelemetry (OTLP)  /v1/logs, /v1/traces               (modules 7, 9)
 *   - Octadash script/SDK   /o/*                               (modules 3, 5)
 * Routes arrive with their modules. This file stays free of database access in
 * the health check so uptime probes never wake a database.
 */
export function createApp() {
  const app = new Hono()

  // SDKs call ingest from browsers on other domains.
  app.use('*', cors({ origin: '*', allowMethods: ['GET', 'POST', 'OPTIONS'], maxAge: 86_400 }))

  app.get('/health', (c) => c.json({ status: 'ok', service: 'ingest', version: OCTADASH_VERSION }))

  app.notFound((c) => c.json({ error: 'not_found' }, 404))

  return app
}
