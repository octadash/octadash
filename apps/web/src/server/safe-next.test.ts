import { describe, expect, it } from 'vitest'
import { safeNext } from './safe-next'

describe('safeNext', () => {
  it('keeps same-site paths', () => {
    expect(safeNext('/invite/abc')).toBe('/invite/abc')
  })

  it('rejects other sites and junk', () => {
    for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '', null]) {
      expect(safeNext(value)).toBe('/all')
    }
  })
})
