import { describe, expect, it } from 'vitest'
import en from '../../messages/en.json'
import pt from '../../messages/pt-BR.json'

function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

describe('messages', () => {
  it('has the same keys in every language', () => {
    expect(keys(pt).sort()).toEqual(keys(en).sort())
  })
})
