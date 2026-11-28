import { decryptSecret } from '@octadash/core'
import { listChannels, recordInvitationEmail } from '@octadash/db'
import { isEmailIntegration, sendDirectEmail } from '@octadash/integrations'
import { getTranslations } from 'next-intl/server'
import { services } from './context'

/**
 * The channel that sends invitations: the organization's first enabled email
 * channel. Without one, people copy the link and send it themselves.
 */
export function inviteChannelOf<T extends { integration: string; enabled: boolean }>(
  channels: T[],
): T | null {
  return channels.find((c) => c.enabled && isEmailIntegration(c.integration)) ?? null
}

/**
 * Emails the invitation link through the organization's email channel, in that
 * channel's language, and keeps whether it went out. Returns null when there is
 * no email channel, else whether it was sent.
 */
export async function emailInvitation(input: {
  orgId: string
  orgName: string
  inviterName: string
  invitationId: string
  email: string
  expiresAt: Date
}): Promise<{ sent: true } | { sent: false; error: string } | null> {
  const { db, env } = services()
  const channel = inviteChannelOf(await listChannels(db, input.orgId))
  if (!channel || !isEmailIntegration(channel.integration)) return null
  const config: Record<string, unknown> = { ...(channel.config as Record<string, unknown>) }
  for (const [key, value] of Object.entries((channel.secrets as Record<string, string>) ?? {})) {
    config[key] = decryptSecret(value, env.OCTADASH_SECRET)
  }
  const locale = channel.locale === 'pt-BR' ? 'pt-BR' : 'en'
  const t = await getTranslations({ locale, namespace: 'members.mail' })
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(input.expiresAt)
  try {
    await sendDirectEmail(
      channel.integration,
      config,
      {
        to: input.email,
        subject: t('subject', { inviter: input.inviterName, org: input.orgName }),
        text: t('body', {
          inviter: input.inviterName,
          org: input.orgName,
          link: `${env.OCTADASH_URL}/invite/${input.invitationId}`,
          date,
        }),
      },
      { fetch, signal: AbortSignal.timeout(15_000) },
    )
    await recordInvitationEmail(db, input.orgId, input.invitationId, {
      channelId: channel.id,
      sentAt: new Date(),
    })
    return { sent: true }
  } catch (error) {
    const message = (error as Error).message || 'Unknown error'
    await recordInvitationEmail(db, input.orgId, input.invitationId, {
      channelId: channel.id,
      error: message,
    })
    return { sent: false, error: message }
  }
}
