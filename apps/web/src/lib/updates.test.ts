import { describe, expect, it } from 'vitest'
import { isNewer, isRelease } from './updates'

describe('update check', () => {
  it('compares plain versions number by number', () => {
    expect(isNewer('1.10.0', '1.9.3')).toBe(true)
    expect(isNewer('v1.2.0', '1.1.9')).toBe(true)
    expect(isNewer('1.2.0', '1.2.0')).toBe(false)
    expect(isNewer('1.1.0', '1.2.0')).toBe(false)
  })

  it('never calls a pre-release or edge newer', () => {
    expect(isNewer('2.0.0-rc.1', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0', 'edge')).toBe(false)
    expect(isRelease('edge')).toBe(false)
    expect(isRelease('1.4.0')).toBe(true)
  })
})
