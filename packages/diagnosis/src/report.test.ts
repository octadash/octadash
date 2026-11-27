import { describe, expect, it } from 'vitest'
import type { Snapshot } from './collect'
import { buildReport } from './report'
import type { LevelId, Status } from './types'

function snapshot(parts: Partial<Snapshot> = {}): Snapshot {
  return {
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    reachable: true,
    httpStatus: 200,
    durationMs: 400,
    error: null,
    redirects: [],
    html: '',
    scriptUrls: [],
    linkUrls: [],
    bundles: [],
    httpsRedirect: true,
    tls: { validTo: '2027-01-01T00:00:00.000Z', daysLeft: 60, issuer: 'R11', trusted: true },
    health: { path: '/api/health', status: 200, durationMs: 40 },
    ...parts,
  }
}

const statuses = (s: Snapshot) =>
  Object.fromEntries(buildReport(s).levels.map((l) => [l.id, l.status])) as Record<LevelId, Status>

describe('buildReport', () => {
  it('leaves everything but "alive" unknown when the site is down', () => {
    const report = buildReport(
      snapshot({ reachable: false, finalUrl: null, httpStatus: null, error: 'ECONNREFUSED' }),
    )
    expect(report.levels.map((l) => l.status)).toEqual([
      'missing',
      'unknown',
      'unknown',
      'unknown',
      'unknown',
      'unknown',
    ])
    expect(report.levels[0]?.findings[0]).toEqual({
      id: 'unreachable',
      status: 'missing',
      params: { error: 'ECONNREFUSED' },
    })
    expect(report.score).toBe(0)
  })

  it('scores a bare but healthy site', () => {
    expect(statuses(snapshot())).toEqual({
      alive: 'ok',
      used: 'missing',
      breaking: 'missing',
      growing: 'missing',
      earning: 'unknown',
      understood: 'unknown',
    })
    expect(buildReport(snapshot()).score).toBe(1)
  })

  it('marks "alive" partial on plain http or a certificate about to expire', () => {
    expect(statuses(snapshot({ finalUrl: 'http://example.com/', tls: null })).alive).toBe('partial')
    const expiring = buildReport(
      snapshot({ tls: { validTo: '', daysLeft: 5, issuer: null, trusted: true } }),
    )
    expect(expiring.levels[0]?.status).toBe('partial')
    expect(expiring.levels[0]?.findings).toContainEqual({
      id: 'certificate_expiring',
      status: 'partial',
      params: { days: 5 },
    })
  })

  it('keeps speed and health as advice, not as a lower level', () => {
    const report = buildReport(snapshot({ durationMs: 6000, health: null }))
    expect(report.levels[0]?.status).toBe('ok')
    expect(report.levels[0]?.findings).toContainEqual({
      id: 'speed',
      status: 'missing',
      params: { ms: 6000 },
    })
    expect(report.levels[0]?.findings).toContainEqual({ id: 'health', status: 'missing' })
  })

  it('climbs the levels with the tools it finds', () => {
    const report = buildReport(
      snapshot({
        scriptUrls: ['https://cloud.umami.is/script.js', 'https://js.stripe.com/v3/'],
        bundles: ['posthog.init("phc_x",{api_host:"https://eu.i.posthog.com"});__SENTRY__'],
      }),
    )
    expect(Object.fromEntries(report.levels.map((l) => [l.id, l.status]))).toEqual({
      alive: 'ok',
      used: 'ok',
      breaking: 'ok',
      growing: 'partial',
      earning: 'partial',
      understood: 'unknown',
    })
    expect(report.levels[1]?.findings[0]).toEqual({
      id: 'used_found',
      status: 'ok',
      params: { tools: 'Umami, PostHog' },
    })
    expect(report.score).toBe(5)
  })
})
