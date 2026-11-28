import type { Db } from './client'

export interface OrganizationSettings {
  /** ISO 4217: "BRL". */
  currency: string
  /** IANA: "America/Sao_Paulo". */
  timeZone: string
}

/** What an organization uses until someone chooses. */
export const DEFAULT_SETTINGS: OrganizationSettings = { currency: 'USD', timeZone: 'UTC' }

/** True for a zone the runtime knows ("America/Sao_Paulo", "UTC"). */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return value.length > 0
  } catch {
    return false
  }
}

/** True for a currency code the runtime can format ("BRL", "USD"). */
export function isCurrency(value: string): boolean {
  if (!/^[A-Z]{3}$/.test(value)) return false
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: value })
    return true
  } catch {
    return false
  }
}

export async function getOrganizationSettings(
  db: Db,
  orgId: string,
): Promise<OrganizationSettings> {
  const row = await db
    .selectFrom('organization_settings')
    .select(['currency', 'time_zone'])
    .where('org_id', '=', orgId)
    .executeTakeFirst()
  return row ? { currency: row.currency, timeZone: row.time_zone } : DEFAULT_SETTINGS
}

/** Saves the currency and time zone. Throws on a code or zone the runtime does not know. */
export async function saveOrganizationSettings(
  db: Db,
  orgId: string,
  settings: OrganizationSettings,
) {
  if (!isCurrency(settings.currency)) throw new Error(`Unknown currency: ${settings.currency}`)
  if (!isTimeZone(settings.timeZone)) throw new Error(`Unknown time zone: ${settings.timeZone}`)
  await db
    .insertInto('organization_settings')
    .values({ org_id: orgId, currency: settings.currency, time_zone: settings.timeZone })
    .onConflict((oc) =>
      oc.column('org_id').doUpdateSet({
        currency: settings.currency,
        time_zone: settings.timeZone,
        updated_at: new Date(),
      }),
    )
    .execute()
}

/** True once someone hid the "Get started" list of this organization. */
export async function isGetStartedHidden(db: Db, orgId: string): Promise<boolean> {
  const row = await db
    .selectFrom('organization_settings')
    .select('get_started_hidden_at')
    .where('org_id', '=', orgId)
    .executeTakeFirst()
  return Boolean(row?.get_started_hidden_at)
}

/** Hides the "Get started" list for everyone in the organization. */
export async function hideGetStarted(db: Db, orgId: string, at = new Date()) {
  await db
    .insertInto('organization_settings')
    .values({ org_id: orgId, get_started_hidden_at: at })
    .onConflict((oc) => oc.column('org_id').doUpdateSet({ get_started_hidden_at: at }))
    .execute()
}

/** The steps of "Get started", in the order the list shows them. */
export const GET_STARTED_STEPS = ['product', 'area', 'alerts', 'watcher', 'invite'] as const
export type GetStartedStep = (typeof GET_STARTED_STEPS)[number]

/**
 * Which "Get started" steps the organization has done: a product, one area
 * set up (a monitor, a data source or an area marked set up), a channel that
 * can receive alerts, the install's outside watcher, and someone invited.
 */
export async function getStartedProgress(
  db: Db,
  orgId: string,
): Promise<Record<GetStartedStep, boolean>> {
  const row = await db
    .selectNoFrom((eb) => [
      eb.exists(eb.selectFrom('project').select('id').where('org_id', '=', orgId)).as('product'),
      eb
        .or([
          eb.exists(eb.selectFrom('monitor').select('id').where('org_id', '=', orgId)),
          eb.exists(eb.selectFrom('source').select('id').where('org_id', '=', orgId)),
          eb.exists(
            eb
              .selectFrom('project_area')
              .select('project_id')
              .where('org_id', '=', orgId)
              .where('state', '=', 'set_up'),
          ),
        ])
        .as('area'),
      eb
        .exists(
          eb
            .selectFrom('channel')
            .select('id')
            .where('org_id', '=', orgId)
            .where('enabled', '=', true),
        )
        .as('alerts'),
      eb
        .exists(
          eb.selectFrom('octadash_instance').select('id').where('watcher_url', 'is not', null),
        )
        .as('watcher'),
      eb
        .or([
          eb.exists(
            eb.selectFrom('auth_invitation').select('id').where('organizationId', '=', orgId),
          ),
          // Someone besides the first member.
          eb.exists(
            eb.selectFrom('auth_member').select('id').where('organizationId', '=', orgId).offset(1),
          ),
        ])
        .as('invite'),
    ])
    .executeTakeFirstOrThrow()
  return {
    product: Boolean(row.product),
    area: Boolean(row.area),
    alerts: Boolean(row.alerts),
    watcher: Boolean(row.watcher),
    invite: Boolean(row.invite),
  }
}

/**
 * Deletes everything the organization has in Postgres: products (with their
 * sources, keys, monitors, areas and rules), channels, incidents and their
 * notifications, groups and settings. Members and invitations go with the
 * organization itself, in auth. Events in ClickHouse stay until their TTL;
 * without keys or products nothing reaches them.
 */
export async function deleteOrganizationData(db: Db, orgId: string) {
  await db.transaction().execute(async (tx) => {
    for (const table of [
      'notification',
      'incident',
      'alert_rule',
      'channel',
      'product_group',
      'project',
      'organization_settings',
      'member_seen',
      'invitation_email',
    ] as const) {
      await tx.deleteFrom(table).where('org_id', '=', orgId).execute()
    }
  })
}
