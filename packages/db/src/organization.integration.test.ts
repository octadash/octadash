import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setProjectArea } from './areas'
import { createChannel } from './channels'
import { createDb } from './client'
import { migrateToLatest } from './migrate'
import {
  DEFAULT_SETTINGS,
  getOrganizationSettings,
  getStartedProgress,
  hideGetStarted,
  isCurrency,
  isGetStartedHidden,
  isTimeZone,
  saveOrganizationSettings,
} from './organization'
import { createProject } from './projects'

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
  const clean = async () => {
    await db.deleteFrom('organization_settings').where('org_id', '=', org).execute()
    await db.deleteFrom('channel').where('org_id', '=', org).execute()
    await db.deleteFrom('project').where('org_id', '=', org).execute()
  }

  beforeAll(async () => {
    await migrateToLatest(db)
    await clean()
  })
  afterAll(async () => {
    await clean()
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

  it('hides the Get started list for good', async () => {
    expect(await isGetStartedHidden(db, org)).toBe(false)
    await hideGetStarted(db, org)
    expect(await isGetStartedHidden(db, org)).toBe(true)
    // Hiding keeps the settings already chosen.
    expect((await getOrganizationSettings(db, org)).timeZone).toBe('America/Recife')
  })

  it('tells which Get started steps are done', async () => {
    const before = await getStartedProgress(db, org)
    expect(before).toMatchObject({ product: false, area: false, alerts: false, invite: false })
    const project = await createProject(db, org, { name: 'Steps' })
    await setProjectArea(db, org, project.id, 'traffic', 'set_up')
    await createChannel(db, org, {
      integration: 'webhook',
      name: 'Hook',
      locale: 'en',
      config: {},
      secrets: {},
      enabled: true,
    })
    expect(await getStartedProgress(db, org)).toMatchObject({
      product: true,
      area: true,
      alerts: true,
      invite: false,
    })
  })
})
