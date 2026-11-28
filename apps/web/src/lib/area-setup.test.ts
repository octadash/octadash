import { describe, expect, it } from 'vitest'
import { areaSetup, canFeed } from './area-setup'

const site = {
  id: 's',
  name: 'Site',
  platform: 'html',
  areas: ['errors', 'logs', 'traffic', 'usage'],
}
const api = { id: 'a', name: 'API', platform: 'node', areas: ['errors'] }

describe('area setup', () => {
  it('never takes a browser source for Logs, even one marked for it', () => {
    expect(canFeed('logs', 'html')).toBe(false)
    expect(canFeed('logs', 'nextjs')).toBe(true)
    expect(areaSetup('logs', { sources: [site], hadData: false, dismissed: false })).toEqual({
      state: 'none',
      source: null,
    })
  })

  it('offers a server source for Logs instead', () => {
    const setup = areaSetup('logs', { sources: [site, api], hadData: false, dismissed: false })
    expect(setup.state).toBe('canUse')
    expect(setup.source?.name).toBe('API')
  })

  it('waits on the site for Traffic', () => {
    expect(
      areaSetup('traffic', { sources: [site, api], hadData: false, dismissed: false }),
    ).toEqual({
      state: 'waiting',
      source: site,
    })
  })
})
