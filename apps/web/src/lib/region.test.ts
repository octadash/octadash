import { describe, expect, it } from 'vitest'
import { currencyChoices, currencyOfLocale, timeZoneGroups, utcOffset } from './region'

describe('region choices', () => {
  it('guesses the currency from the language tag', () => {
    expect(currencyOfLocale('pt-BR')).toBe('BRL')
    expect(currencyOfLocale('de')).toBe('EUR')
    expect(currencyOfLocale('en-GB')).toBe('GBP')
    expect(currencyOfLocale('en')).toBe('USD')
    expect(currencyOfLocale('xx-QQ')).toBe('USD')
    expect(currencyOfLocale('not a tag')).toBe('USD')
  })

  it('writes the offset the way people read it', () => {
    const june = new Date('2026-06-01T12:00:00Z')
    expect(utcOffset('America/Sao_Paulo', june)).toBe('UTC−3')
    expect(utcOffset('Asia/Kolkata', june)).toBe('UTC+5:30')
    expect(utcOffset('UTC', june)).toBe('UTC')
    expect(utcOffset('America/New_York', june)).toBe('UTC−4')
    expect(utcOffset('America/New_York', new Date('2026-01-15T12:00:00Z'))).toBe('UTC−5')
  })

  it('lists currencies and zones by region, UTC included', () => {
    expect(currencyChoices('en').find((c) => c.value === 'BRL')?.label).toBe('BRL · Brazilian Real')
    const groups = timeZoneGroups(new Date('2026-06-01T12:00:00Z'))
    const america = groups.find((g) => g.region === 'America')
    expect(america?.zones.find((z) => z.value === 'America/Sao_Paulo')?.label).toBe(
      'Sao Paulo (UTC−3)',
    )
    expect(groups.flatMap((g) => g.zones).some((z) => z.value === 'UTC')).toBe(true)
  })
})
