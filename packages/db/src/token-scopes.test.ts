import { describe, expect, it } from 'vitest'
import { allows, cleanScopes, isEmptyScopes, presetOf, TOKEN_PRESETS } from './token-scopes'

describe('token scopes', () => {
  it('keeps only valid resources and levels, and delete only where it can write', () => {
    const scopes = cleanScopes({
      levels: { products: 'write', logs: 'read', money: 'none', nope: 'write', errors: 'admin' },
      delete: ['products', 'logs', 'nope'],
    })
    expect(scopes).toEqual({ levels: { products: 'write', logs: 'read' }, delete: ['products'] })
    expect(cleanScopes('junk')).toEqual({ levels: {}, delete: [] })
  })

  it('write reads too; delete needs its own permission', () => {
    const scopes = cleanScopes({ levels: { products: 'write', logs: 'read' }, delete: [] })
    expect(allows(scopes, 'products', 'read')).toBe(true)
    expect(allows(scopes, 'products', 'write')).toBe(true)
    expect(allows(scopes, 'products', 'delete')).toBe(false)
    expect(allows(scopes, 'logs', 'write')).toBe(false)
    expect(allows(scopes, 'money', 'read')).toBe(false)
  })

  it('the setup preset adds products and sources and deletes nothing', () => {
    const setup = cleanScopes(TOKEN_PRESETS.setup)
    expect(allows(setup, 'sources', 'write')).toBe(true)
    expect(allows(setup, 'keys', 'read')).toBe(true)
    expect(allows(setup, 'keys', 'write')).toBe(false)
    expect(setup.delete).toEqual([])
    expect(isEmptyScopes(cleanScopes({}))).toBe(true)
  })

  it('tells a preset apart from scopes changed by hand, in any key order', () => {
    const reordered = {
      levels: Object.fromEntries(Object.entries(TOKEN_PRESETS.setup.levels).reverse()),
      delete: [],
    }
    expect(presetOf(reordered)).toBe('setup')
    expect(presetOf(TOKEN_PRESETS.read)).toBe('read')
    expect(presetOf({ levels: { logs: 'read' }, delete: [] })).toBeNull()
  })
})
