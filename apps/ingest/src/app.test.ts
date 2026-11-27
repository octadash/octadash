import { describe, expect, it } from 'vitest'
import { createApp } from './app'

describe('ingest app', () => {
  const app = createApp()

  it('answers the health check without a database', async () => {
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'ingest' })
  })

  it('allows cross-origin calls from SDKs', async () => {
    const res = await app.request('/health', { headers: { origin: 'https://postato.com.br' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('returns JSON 404 for unknown routes', async () => {
    const res = await app.request('/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })
})
