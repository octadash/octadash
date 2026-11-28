import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret } from './secrets'

const SECRET = 'x'.repeat(40)

describe('secrets', () => {
  it('round-trips and never repeats the ciphertext', () => {
    const a = encryptSecret('123456:ABC-token', SECRET)
    const b = encryptSecret('123456:ABC-token', SECRET)
    expect(a).not.toBe(b)
    expect(a.startsWith('v1.')).toBe(true)
    expect(decryptSecret(a, SECRET)).toBe('123456:ABC-token')
  })

  it('refuses another key or a changed value', () => {
    const value = encryptSecret('secret', SECRET)
    expect(() => decryptSecret(value, 'y'.repeat(40))).toThrow()
    expect(() => decryptSecret(`${value.slice(0, -2)}AA`, SECRET)).toThrow()
    expect(() => decryptSecret('plain', SECRET)).toThrow()
  })
})
