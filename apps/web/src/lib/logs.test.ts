import { describe, expect, it } from 'vitest'
import {
  histogramStep,
  levelTag,
  logsHref,
  parseLogsState,
  queryValue,
  readableBytes,
} from './logs'
import { LOG_TABS, logSnippet, logTabOf } from './logs-setup'

describe('logs state', () => {
  it('reads the address with defaults', () => {
    expect(parseLogsState({})).toEqual({ period: '24h', q: '', live: true })
    expect(parseLogsState({ period: '7d', q: ' level:error ', live: '0' })).toEqual({
      period: '7d',
      q: 'level:error',
      live: false,
    })
    expect(parseLogsState({ period: 'year' }).period).toBe('24h')
  })

  it('leaves defaults out of links', () => {
    const state = parseLogsState({})
    expect(logsHref('/all/logs', state, {})).toBe('/all/logs')
    expect(logsHref('/all/logs', state, { q: 'service:api', period: '7d' })).toBe(
      '/all/logs?period=7d&q=service%3Aapi',
    )
  })

  it('keeps about 90 bars or fewer', () => {
    expect(histogramStep('24h', 86_400_000)).toBe(900)
    expect(histogramStep('today', 3_600_000)).toBe(300)
    expect((30 * 86_400) / histogramStep('30d', 0)).toBe(90)
  })

  it('formats levels, values and bytes', () => {
    expect(levelTag('fatal')).toBe('FTL')
    expect(levelTag('whatever')).toBe('INF')
    expect(queryValue('api')).toBe('api')
    expect(queryValue('POST /orders')).toBe('"POST /orders"')
    expect(readableBytes(1_200_000_000, 'en')).toBe('1.2 GB')
    expect(readableBytes(512, 'en')).toBe('512 byte')
  })
})

describe('logs setup', () => {
  const options = {
    ingestUrl: 'https://ingest.example.com',
    publicKey: 'pk123',
    service: 'api',
  }

  it('picks a tab from the platform', () => {
    expect(logTabOf('dotnet')).toBe('dotnet')
    expect(logTabOf('nextjs')).toBe('node')
    expect(logTabOf('other')).toBe('other')
    expect(logTabOf(null)).toBe('dotnet')
  })

  it('every snippet carries the key, the service and the address', () => {
    for (const tab of LOG_TABS) {
      const s = logSnippet(tab, options)
      expect(s.code, tab).toContain('pk123')
      // The Collector receives service.name from the apps that send to it.
      if (tab !== 'collector') expect(s.code, tab).toContain('api')
      expect(s.code, tab).toContain('https://ingest.example.com/otlp')
    }
  })
})
