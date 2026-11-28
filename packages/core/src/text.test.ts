import { describe, expect, it } from 'vitest'
import { generatePublicKey, normalizeUrl, slugify } from './text'

describe('slugify', () => {
  it('handles accents and spaces', () => {
    expect(slugify('Orbita de Ideias')).toBe('orbita-de-ideias')
    expect(slugify('  Fieldnote São Paulo! ')).toBe('fieldnote-sao-paulo')
  })
  it('never returns an empty slug', () => {
    expect(slugify('***')).toBe('product')
  })
})

describe('generatePublicKey', () => {
  it('looks like a Sentry public key', () => {
    expect(generatePublicKey()).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('normalizeUrl', () => {
  it('adds https and drops the trailing slash', () => {
    expect(normalizeUrl('pagebird.com.br/')).toBe('https://pagebird.com.br')
    expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000')
  })
  it('rejects things that are not addresses', () => {
    expect(normalizeUrl('')).toBeNull()
    expect(normalizeUrl('not a url')).toBeNull()
    expect(normalizeUrl('pagebird')).toBeNull()
  })
})
