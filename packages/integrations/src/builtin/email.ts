import { createTransport } from 'nodemailer'
import { z } from 'zod'
import { defineNotification } from '../define'
import type { AlertMessage, IntegrationContext } from '../types'

/** One or more addresses separated by commas. */
const recipients = z
  .string()
  .min(3)
  .refine(
    (value) => splitAddresses(value).every((address) => z.email().safeParse(address).success),
    'One or more e-mail addresses, separated by commas',
  )

export function splitAddresses(value: string): string[] {
  return value
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean)
}

export function emailSubject(message: AlertMessage): string {
  const product = message.project ? `${message.project.name}: ` : ''
  return `[Octadash] ${product}${message.title}`
}

export function emailText(message: AlertMessage): string {
  return [message.body, message.url ? `\n${message.url}` : ''].join('').trim()
}

const smtpConfig = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65_535).default(587),
  /** Implicit TLS from the first byte (usually port 465). Port 587 upgrades with STARTTLS. */
  secure: z.boolean().default(false),
  username: z.string().optional(),
  password: z.string().optional(),
  from: z.string().min(3),
  to: recipients,
})

function smtpTransport(cfg: z.infer<typeof smtpConfig>) {
  return createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.username ? { user: cfg.username, pass: cfg.password ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
}

export const smtp = defineNotification({
  id: 'smtp',
  kind: 'notification',
  name: 'E-mail (SMTP)',
  description: {
    en: 'SMTP works with any provider (Postmark, SendGrid, Mailgun, Amazon SES, Brevo, Gmail, your own server). A provider gets its own option when its API adds something SMTP lacks.',
    'pt-BR':
      'SMTP funciona com qualquer provedor (Postmark, SendGrid, Mailgun, Amazon SES, Brevo, Gmail, o seu servidor). Um provedor ganha opção própria quando a API dele traz algo que o SMTP não tem.',
  },
  config: smtpConfig,
  secretKeys: ['password'],
  async test(cfg) {
    try {
      const transport = smtpTransport(cfg)
      await transport.sendMail({
        from: cfg.from,
        to: splitAddresses(cfg.to),
        subject: '[Octadash] Test message',
        text: 'Octadash can send alerts to this address.',
      })
      transport.close()
      return { ok: true }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  },
  async send(message, cfg) {
    const transport = smtpTransport(cfg)
    try {
      await transport.sendMail({
        from: cfg.from,
        to: splitAddresses(cfg.to),
        subject: emailSubject(message),
        text: emailText(message),
      })
    } finally {
      transport.close()
    }
  },
})

const resendConfig = z.object({
  apiKey: z.string().startsWith('re_', 'Resend API keys start with re_'),
  from: z.string().min(3),
  to: recipients,
})

async function callResend(
  cfg: z.infer<typeof resendConfig>,
  subject: string,
  text: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
  to = splitAddresses(cfg.to),
) {
  const response = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: cfg.from, to, subject, text }),
    signal,
  })
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(detail?.message ?? `Resend answered ${response.status}`)
  }
}

export const resend = defineNotification({
  id: 'resend',
  kind: 'notification',
  name: 'E-mail (Resend)',
  description: {
    en: 'Sends alerts by e-mail through the Resend API, with a domain you verified there.',
    'pt-BR': 'Envia alertas por e-mail pela API do Resend, com um domínio verificado lá.',
  },
  docsUrl: 'https://resend.com/docs/api-reference/emails/send-email',
  config: resendConfig,
  secretKeys: ['apiKey'],
  async test(cfg, ctx) {
    try {
      await callResend(
        cfg,
        '[Octadash] Test message',
        'Octadash can send alerts to this address.',
        ctx.fetch,
        ctx.signal,
      )
      return { ok: true }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  },
  async send(message, cfg, ctx) {
    await callResend(cfg, emailSubject(message), emailText(message), ctx.fetch, ctx.signal)
  },
})

/** The email integrations, which can also write to one person (an invitation). */
export const EMAIL_INTEGRATIONS = ['smtp', 'resend'] as const
export type EmailIntegration = (typeof EMAIL_INTEGRATIONS)[number]

export function isEmailIntegration(id: string): id is EmailIntegration {
  return (EMAIL_INTEGRATIONS as readonly string[]).includes(id)
}

/**
 * Sends one email to one address through an email channel's account, from
 * the channel's sender. Used for invitations, which go to a person who is not
 * among the channel's recipients yet.
 */
export async function sendDirectEmail(
  integration: EmailIntegration,
  config: unknown,
  mail: { to: string; subject: string; text: string },
  ctx: IntegrationContext,
): Promise<void> {
  if (integration === 'resend') {
    const cfg = resendConfig.parse(config)
    await callResend(cfg, mail.subject, mail.text, ctx.fetch, ctx.signal, [mail.to])
    return
  }
  const cfg = smtpConfig.parse(config)
  const transport = smtpTransport(cfg)
  try {
    await transport.sendMail({
      from: cfg.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    })
  } finally {
    transport.close()
  }
}
