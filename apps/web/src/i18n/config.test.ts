import { describe, expect, it } from 'vitest'
import { resolveLocale } from './config'

describe('resolveLocale', () => {
  it('prefers the cookie', () => {
    expect(resolveLocale('pt-BR', 'en-US')).toBe('pt-BR')
  })

  it('falls back to Accept-Language', () => {
    expect(resolveLocale(undefined, 'pt-PT,pt;q=0.9,en;q=0.8')).toBe('pt-BR')
    expect(resolveLocale(undefined, 'en-GB')).toBe('en')
  })

  it('defaults to English', () => {
    expect(resolveLocale('fr', 'de-DE')).toBe('en')
    expect(resolveLocale(undefined, null)).toBe('en')
  })
})
