import type { Integration } from '../types'
import { resend, smtp } from './email'
import { telegram } from './telegram'
import { webhook } from './webhook'

/** Integrations shipped with Octadash. Slack and Discord work through the webhook for now. */
export const builtinIntegrations: Integration[] = [smtp, resend, telegram, webhook] as Integration[]

export {
  EMAIL_INTEGRATIONS,
  type EmailIntegration,
  isEmailIntegration,
  sendDirectEmail,
} from './email'
export { findTelegramChats, type TelegramChat } from './telegram'
export { resend, smtp, telegram, webhook }
