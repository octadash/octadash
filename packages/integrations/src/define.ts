import type { z } from 'zod'
import type { NotificationIntegration, SourceIntegration } from './types'

/** Identity helpers that keep the config type flowing into test() and send(). */
export function defineNotification<TConfig extends z.ZodType>(
  integration: NotificationIntegration<TConfig>,
): NotificationIntegration<TConfig> {
  return integration
}

export function defineSource<TConfig extends z.ZodType>(
  integration: SourceIntegration<TConfig>,
): SourceIntegration<TConfig> {
  return integration
}
