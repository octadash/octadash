import { describe, expect, it } from 'vitest'
import { uuidv7, uuidv7Time } from './id'

describe('uuidv7', () => {
  it('produces a valid version 7 UUID', () => {
    const id = uuidv7()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('encodes the creation time', () => {
    const now = Date.UTC(2026, 10, 27, 12, 0, 0)
    expect(uuidv7Time(uuidv7(now)).getTime()).toBe(now)
  })

  it('sorts by creation time', () => {
    const a = uuidv7(1_000)
    const b = uuidv7(2_000)
    expect(a < b).toBe(true)
  })
})
