import { ERROR_PLATFORMS } from './errors-setup'
import { LOG_SOURCE_PLATFORMS } from './logs-setup'
import { TRAFFIC_PLATFORMS } from './traffic-setup'
import { USAGE_SOURCE_PLATFORMS } from './usage-setup'

/** The areas that sources feed, each with the platforms its first step offers. */
export const SOURCE_AREA_PLATFORMS = {
  errors: ERROR_PLATFORMS,
  traffic: TRAFFIC_PLATFORMS,
  usage: USAGE_SOURCE_PLATFORMS,
  logs: LOG_SOURCE_PLATFORMS,
} as const
export type SourceArea = keyof typeof SOURCE_AREA_PLATFORMS

export function isSourceArea(value: string): value is SourceArea {
  return value in SOURCE_AREA_PLATFORMS
}
