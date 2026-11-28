import { AREAS } from '@octadash/db'
import { describe, expect, it } from 'vitest'
import { AREA_ITEMS, areaOf, scopeOf } from './areas'

describe('areas', () => {
  it('lists the same areas as the database, in the same order', () => {
    expect(AREA_ITEMS.map((item) => item.id)).toEqual([...AREAS])
  })

  it('reads the scope from the path', () => {
    expect(scopeOf('/p/trinca/errors')).toEqual({ base: '/p/trinca', slug: 'trinca' })
    expect(scopeOf('/all/uptime')).toEqual({ base: '/all', slug: null })
    expect(scopeOf('/settings/members')).toEqual({ base: '/all', slug: null })
  })

  it('reads the open area from the path', () => {
    expect(areaOf('/p/trinca/errors')).toBe('errors')
    expect(areaOf('/all/money')).toBe('money')
    expect(areaOf('/p/trinca/settings')).toBeNull()
    expect(areaOf('/p/trinca')).toBeNull()
    expect(areaOf('/all')).toBeNull()
  })
})
