import { describe, expect, it } from 'vitest'
import { isNewer, isRelease, versionLabel } from './updates'

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

  it('labels the running version', () => {
    expect(versionLabel('1.4.0', 'abc')).toBe('v1.4.0')
    expect(versionLabel('v1.4.0', '')).toBe('v1.4.0')
    expect(versionLabel('edge', '4752944ee6551b9cfae3482869be6172f481bed0')).toBe('edge · 4752944')
    expect(versionLabel('0.0.0-dev', '')).toBe('0.0.0-dev')
  })
})
