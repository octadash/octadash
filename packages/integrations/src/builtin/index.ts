import type { Integration } from '../types'
import { telegram } from './telegram'
import { webhook } from './webhook'

/** Integrations shipped with Octadash. Email, Slack and Discord arrive with module 2. */
export const builtinIntegrations: Integration[] = [webhook, telegram] as Integration[]

export { telegram, webhook }
