import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { migrateToLatest } from './migrate'
import {
  DEFAULT_SETTINGS,
  getOrganizationSettings,
  isCurrency,
  isTimeZone,
  saveOrganizationSettings,
} from './organization'

const url = process.env.DATABASE_URL
const org = '00000000-0000-4000-8000-0000000000e7'

describe('settings checks', () => {
  it('knows real currencies and time zones only', () => {
    expect(isCurrency('BRL')).toBe(true)
    expect(isCurrency('brl')).toBe(false)
    expect(isCurrency('XXXX')).toBe(false)
    expect(isTimeZone('America/Sao_Paulo')).toBe(true)
    expect(isTimeZone('Mars/Olympus')).toBe(false)
    expect(isTimeZone('')).toBe(false)
  })
})

describe.skipIf(!url)('organization settings (needs DATABASE_URL)', () => {
  const { db, pool } = createDb(url ?? '', { max: 2 })

  beforeAll(async () => {
    await migrateToLatest(db)
    await db.deleteFrom('organization_settings').where('org_id', '=', org).execute()
  })
  afterAll(async () => {
    await db.deleteFrom('organization_settings').where('org_id', '=', org).execute()
    await pool.end()
  })

  it('uses the defaults until someone chooses, then keeps the choice', async () => {
    expect(await getOrganizationSettings(db, org)).toEqual(DEFAULT_SETTINGS)
    await saveOrganizationSettings(db, org, { currency: 'BRL', timeZone: 'America/Sao_Paulo' })
    await saveOrganizationSettings(db, org, { currency: 'BRL', timeZone: 'America/Recife' })
    expect(await getOrganizationSettings(db, org)).toEqual({
      currency: 'BRL',
      timeZone: 'America/Recife',
    })
    await expect(
      saveOrganizationSettings(db, org, { currency: 'BRL', timeZone: 'Nowhere/Here' }),
    ).rejects.toThrow()
  })
})
