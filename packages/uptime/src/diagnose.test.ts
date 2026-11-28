import { describe, expect, it } from 'vitest'
import { diagnose } from './diagnose'

describe('diagnose', () => {
  it('tells what answered from here and where the product lives', async () => {
    const result = await diagnose(
      'https://api.example.com/health',
      { ip: '203.0.113.7', status: 502, error: 'HTTP 502' },
      {
        controls: ['https://one.one.one.one/', 'https://unreachable.test/'],
        fetch: (async (input: string | URL | Request) => {
          if (String(input).includes('unreachable')) throw new TypeError('fetch failed')
          return new Response(null)
        }) as typeof fetch,
        inspectTls: async () => ({ validTo: '', daysLeft: 88, issuer: null, trusted: true }),
        ownAddresses: async () => new Set(['198.51.100.9']),
      },
    )
    expect(result).toMatchObject({
      host: 'api.example.com',
      ip: '203.0.113.7',
      tls: { daysLeft: 88, trusted: true },
      status: 502,
      sameServer: false,
    })
    expect(result.controls.map((c) => [c.target, c.ms === null])).toEqual([
      ['one.one.one.one', false],
      ['unreachable.test', true],
    ])
  })

  it('resolves the host when the check never reached it, and skips TLS on http', async () => {
    const result = await diagnose(
      'http://shop.example.com/',
      { ip: null, status: null, error: 'ENOTFOUND' },
      { controls: [], resolve: async () => null, ownAddresses: async () => new Set() },
    )
    expect(result).toMatchObject({ ip: null, tls: null, sameServer: null, controls: [] })
  })
})
