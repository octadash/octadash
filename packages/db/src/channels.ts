import { uuidv7 } from '@octadash/core'
import type { Db } from './client'

export interface ChannelInput {
  integration: string
  name: string
  locale: string
  config: Record<string, unknown>
  /** Already encrypted. */
  secrets: Record<string, string>
  enabled: boolean
}

export function listChannels(db: Db, orgId: string) {
  return db
    .selectFrom('channel')
    .selectAll()
    .where('org_id', '=', orgId)
    .orderBy('created_at')
    .execute()
}

/** Channels that may receive alerts, for several organizations at once. */
export function listEnabledChannels(db: Db, orgIds: string[]) {
  if (orgIds.length === 0) return Promise.resolve([])
  return db
    .selectFrom('channel')
    .selectAll()
    .where('org_id', 'in', orgIds)
    .where('enabled', '=', true)
    .orderBy('created_at')
    .execute()
}

export type ChannelRow = Awaited<ReturnType<typeof listEnabledChannels>>[number]

export function getChannel(db: Db, orgId: string, channelId: string) {
  return db
    .selectFrom('channel')
    .selectAll()
    .where('org_id', '=', orgId)
    .where('id', '=', channelId)
    .executeTakeFirst()
}

export async function createChannel(db: Db, orgId: string, input: ChannelInput) {
  return db
    .insertInto('channel')
    .values({
      id: uuidv7(),
      org_id: orgId,
      integration: input.integration,
      name: input.name.trim(),
      locale: input.locale,
      config: JSON.stringify(input.config),
      secrets: JSON.stringify(input.secrets),
      enabled: input.enabled,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}

export async function updateChannel(
  db: Db,
  orgId: string,
  channelId: string,
  input: Omit<ChannelInput, 'integration'>,
) {
  return db
    .updateTable('channel')
    .set({
      name: input.name.trim(),
      locale: input.locale,
      config: JSON.stringify(input.config),
      secrets: JSON.stringify(input.secrets),
      enabled: input.enabled,
      updated_at: new Date(),
    })
    .where('org_id', '=', orgId)
    .where('id', '=', channelId)
    .returningAll()
    .executeTakeFirst()
}

export async function deleteChannel(db: Db, orgId: string, channelId: string) {
  await db.deleteFrom('channel').where('org_id', '=', orgId).where('id', '=', channelId).execute()
}

/** The last message sent to each channel, to show it works (or why it does not). */
export async function lastNotifications(db: Db, orgId: string) {
  const rows = await db
    .selectFrom('notification')
    .select(['channel_id', 'ok', 'error', 'sent_at'])
    .distinctOn('channel_id')
    .where('org_id', '=', orgId)
    .where('channel_id', 'is not', null)
    .orderBy('channel_id')
    .orderBy('sent_at', 'desc')
    .execute()
  return new Map(rows.map((row) => [row.channel_id as string, row]))
}
