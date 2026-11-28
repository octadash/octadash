/**
 * Where everything the ingest receives goes. The rule: data that arrives is
 * kept. What an area reads goes to that area's stream (events, errors,
 * logs); what no area reads yet goes to `received`, as it came and masked, so
 * the area that comes later has its history. A kind nobody has seen before
 * (a new Sentry item type, a new PostHog event) is kept in `received` too.
 *
 * Leaving data out is the exception. Each case is in DISCARDS with its reason,
 * and the ones taken with a 200 answer leave a `dropped:` row that counts
 * them. fates.test.ts fails when a route is added without an entry in ROUTES,
 * or when a kind of data stops reaching a stream.
 */

/** What each route does with what it receives. Keys are "METHOD path" as Hono registers them. */
export const ROUTES: Record<string, string> = {
  'GET /health': 'no data: answers the health check',
  'GET /o/v1/script.js': 'no data: serves the browser script',
  'GET /hb/:token': 'heartbeat ping (Valkey), then a row in uptime_checks',
  'POST /hb/:token': 'heartbeat ping (Valkey), then a row in uptime_checks',
  'GET /hb/:token/fail': 'heartbeat failure (Valkey), then a row in uptime_checks',
  'POST /hb/:token/fail': 'heartbeat failure (Valkey), then a row in uptime_checks',
  'GET /o/v1/hb/:token': 'heartbeat ping (Valkey), then a row in uptime_checks',
  'POST /o/v1/hb/:token': 'heartbeat ping (Valkey), then a row in uptime_checks',
  'GET /o/v1/hb/:token/fail': 'heartbeat failure (Valkey), then a row in uptime_checks',
  'POST /o/v1/hb/:token/fail': 'heartbeat failure (Valkey), then a row in uptime_checks',
  'POST /o/v1/events': 'events',
  'POST /e': 'events; $exception to errors; other PostHog events to received',
  'POST /e/': 'events; $exception to errors; other PostHog events to received',
  'POST /i/v0/e': 'events; $exception to errors; other PostHog events to received',
  'POST /i/v0/e/': 'events; $exception to errors; other PostHog events to received',
  'POST /batch': 'events; $exception to errors; other PostHog events to received',
  'POST /batch/': 'events; $exception to errors; other PostHog events to received',
  'POST /capture': 'events; $exception to errors; other PostHog events to received',
  'POST /capture/': 'events; $exception to errors; other PostHog events to received',
  'POST /track': 'events; $exception to errors; other PostHog events to received',
  'POST /track/': 'events; $exception to errors; other PostHog events to received',
  'POST /engage': 'received (person updates, masked)',
  'POST /engage/': 'received (person updates, masked)',
  'GET /flags': 'no data: answers the flags request',
  'POST /flags': 'no data: answers the flags request',
  'GET /flags/': 'no data: answers the flags request',
  'POST /flags/': 'no data: answers the flags request',
  'GET /decide': 'no data: answers the flags request',
  'POST /decide': 'no data: answers the flags request',
  'GET /decide/': 'no data: answers the flags request',
  'POST /decide/': 'no data: answers the flags request',
  'GET /array/:token/config': 'no data: answers the remote config request',
  'GET /array/:token/config.js': 'no data: answers the remote config request',
  'GET /static/:file': 'no data: redirects to the posthog-js files',
  'POST /api/:id/envelope/':
    'errors; transactions and spans to spans; logs to logs; every other item type to received',
  'POST /api/:id/envelope':
    'errors; transactions and spans to spans; logs to logs; every other item type to received',
  'POST /api/:id/store/': 'errors',
  'POST /api/:id/store': 'errors',
  'POST /o/v1/errors': 'errors',
  'POST /v1/logs': 'logs',
  'POST /otlp/v1/logs': 'logs',
  'POST /v1/traces': 'spans',
  'POST /otlp/v1/traces': 'spans',
  'POST /v1/metrics': 'metrics',
  'POST /otlp/v1/metrics': 'metrics',
}

/**
 * Every case where data that arrived is not kept whole, and why. A reason used
 * in a `dropped:` row must be a key here (the type checks it).
 */
export const DISCARDS = {
  personal_data:
    'E-mails, CPF, CNPJ, phone numbers, passwords, cards and IP addresses are masked or left out, for privacy. The count of masked values is kept on the row.',
  dismissed_area:
    'The product marked the area "I won\'t use this". Its data is counted on the area card, not stored.',
  too_large:
    'An item bigger than 1 MB is counted, not stored, until file storage (Garage, or an external S3 or R2) keeps files whole.',
  too_many_in_request:
    'Error events beyond the limit of one request are counted, not stored. SDKs send one per request.',
  invalid_span_id:
    'A Sentry span without a valid trace and span id cannot be placed in any trace. It is counted, not stored.',
} as const

export type DiscardReason = keyof typeof DISCARDS
