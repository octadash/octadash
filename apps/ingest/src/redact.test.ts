import { describe, expect, it } from 'vitest'
import { redact, redactAttributes } from './redact'

describe('masking log lines', () => {
  it('masks e-mails, cards, documents and keys, and counts them', () => {
    const { text, masked } = redact(
      'charge for ana@shop.example card 4111 1111 1111 1111 cpf 123.456.789-09 key sk_live_abcdefghijklmnop',
    )
    expect(text).toBe('charge for [email] card [card] cpf [document] key [key]')
    expect(masked).toBe(4)
  })

  it('leaves ids and numbers that are not cards alone', () => {
    expect(redact('order 1234567890123 took 30012 ms').text).toBe(
      'order 1234567890123 took 30012 ms',
    )
  })

  it('masks bearer tokens, JWTs, passwords in URLs and query strings', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    expect(redact(`Authorization: Bearer abcdefghijklmnop`).text).toBe(
      'Authorization: Bearer [secret]',
    )
    expect(redact(`token ${jwt}`).text).toBe('token [key]')
    expect(redact('postgres://app:hunter2@db-1/app').text).toBe('postgres://app:[secret]@db-1/app')
    expect(redact('GET /reset?token=abc123&x=1').text).toBe('GET /reset?token=[secret]&x=1')
  })

  it('reads a long line with no spaces in linear time', () => {
    const started = performance.now()
    expect(redact(`${'x'.repeat(200_000)} ana@shop.example`).text).toContain('[email]')
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('masks attributes named like secrets whole', () => {
    const out = redactAttributes({
      'http.request.header.authorization': 'Basic abc',
      dbPassword: 'x',
      'http.route': '/orders',
      user: 'ana@shop.example',
    })
    expect(out.attributes).toEqual({
      'http.request.header.authorization': '[secret]',
      dbPassword: '[secret]',
      'http.route': '/orders',
      user: '[email]',
    })
    expect(out.masked).toBe(3)
  })
})
