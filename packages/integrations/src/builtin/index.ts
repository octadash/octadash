import type { Integration } from '../types'
import { resend, smtp } from './email'
import { telegram } from './telegram'
import { webhook } from './webhook'

/** Integrations shipped with Octadash. Slack and Discord work through the webhook for now. */
export const builtinIntegrations: Integration[] = [smtp, resend, telegram, webhook] as Integration[]

export { resend, smtp, telegram, webhook }
