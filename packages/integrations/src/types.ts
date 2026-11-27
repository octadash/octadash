import type { z } from 'zod'

/** Text shown in the panel, in every language the UI supports. */
export interface LocalizedText {
  en: string
  'pt-BR': string
}

/**
 * What an integration does:
 * - `notification`: a channel that receives alerts (email, Telegram, Slack, webhook...).
 * - `source`: a service Octadash reads data from (Stripe, Asaas, Paddle, OpenAI...).
 */
export type IntegrationKind = 'notification' | 'source'

export interface TestResult {
  ok: boolean
  message?: string
}

export interface IntegrationContext {
  /** fetch is injected so integrations are easy to test and can be proxied. */
  fetch: typeof fetch
  signal?: AbortSignal
}

/**
 * The contract every integration implements. Users pick integrations in the
 * panel, fill the form generated from `config`, press "Test" and save. Nothing is
 * chosen at install time, in the spirit of Coolify's notification settings.
 */
export interface IntegrationBase<TConfig extends z.ZodType = z.ZodType> {
  /** Stable id, kebab-case, never renamed once released (stored in the database). */
  id: string
  kind: IntegrationKind
  name: string
  description: LocalizedText
  docsUrl?: string
  /** Validates and documents the settings form. Rendered with z.toJSONSchema(). */
  config: TConfig
  /** Config keys stored encrypted and never sent back to the browser. */
  secretKeys: readonly string[]
  test(config: z.infer<TConfig>, ctx: IntegrationContext): Promise<TestResult>
}

export type AlertSeverity = 'info' | 'warning' | 'critical' | 'resolved'

export interface AlertMessage {
  severity: AlertSeverity
  title: string
  body: string
  /** Product (project) the alert belongs to, when there is one. */
  project?: { id: string; name: string }
  /** Link back to the panel. */
  url?: string
  occurredAt: Date
}

export interface NotificationIntegration<TConfig extends z.ZodType = z.ZodType>
  extends IntegrationBase<TConfig> {
  kind: 'notification'
  send(message: AlertMessage, config: z.infer<TConfig>, ctx: IntegrationContext): Promise<void>
}

/** Sources are defined per module (revenue, AI cost, infra cost). Their methods arrive with those modules. */
export interface SourceIntegration<TConfig extends z.ZodType = z.ZodType>
  extends IntegrationBase<TConfig> {
  kind: 'source'
  /** Modules this source feeds, e.g. ['revenue'] for Stripe. */
  feeds: readonly string[]
}

export type Integration = NotificationIntegration | SourceIntegration
