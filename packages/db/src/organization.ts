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
