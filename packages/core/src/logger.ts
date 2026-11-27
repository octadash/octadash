import { type Logger, pino } from 'pino'

export type { Logger }

/**
 * JSON logger writing to stdout. Transports are not used on purpose: they spawn
 * worker threads and break single-file bundles. Pretty printing is done outside
 * the process (`pnpm dev | pino-pretty`).
 */
export function createLogger(service: string, level: string = process.env.LOG_LEVEL ?? 'info') {
  return pino({
    level,
    base: { service },
    redact: {
      paths: ['password', '*.password', 'token', '*.token', 'secret', '*.secret', 'authorization'],
      censor: '[redacted]',
    },
  })
}
