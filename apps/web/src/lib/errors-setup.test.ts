import { describe, expect, it } from 'vitest'
import {
  ERROR_PLATFORMS,
  errorSnippet,
  errorsSetup,
  isErrorPlatform,
  testError,
} from './errors-setup'

const options = {
  ingestUrl: 'https://in.example/',
  publicKey: 'k'.repeat(32),
  dsn: `https://${'k'.repeat(32)}@in.example/4`,
}

describe('Set up Errors', () => {
  it('puts the DSN in every SDK snippet and the key in the script', () => {
    for (const platform of ERROR_PLATFORMS) {
      const snippet = errorSnippet(platform, options)
      if (platform === 'html') {
        expect(snippet.code).toContain('src="https://in.example/o/v1/script.js"')
        expect(snippet.code).toContain(`data-key="${options.publicKey}"`)
      } else {
        expect(snippet.code).toContain(options.dsn)
      }
    }
    expect(errorSnippet('python', options).code).toMatch(/^import os\nimport sentry_sdk/)
  })

  it('knows its platforms and sends a test error the ingest reads', () => {
    expect(isErrorPlatform('dotnet')).toBe(true)
    expect(isErrorPlatform('wordpress')).toBe(false)
    const body = testError('abc', new Date(1_795_000_000_000))
    expect(body.key).toBe('abc')
    expect(body.events[0]?.exception.values[0]?.type).toBe('OctadashTestError')
  })
})

describe('where a product stands on Errors', () => {
  const site = { id: 's1', name: 'Site', platform: 'html', areas: ['traffic'] }
  const api = { id: 's2', name: 'API', platform: 'node', areas: ['logs'] }
  const sdk = { id: 's3', name: 'App', platform: 'nextjs', areas: ['errors'] }
  const base = { sources: [], hadIssue: false, dismissed: false }

  it('sends once an issue was ever seen, even if the source is gone', () => {
    expect(errorsSetup({ ...base, hadIssue: true })).toEqual({ state: 'sending', source: null })
    expect(errorsSetup({ ...base, sources: [api, sdk], hadIssue: true }).source).toBe(sdk)
  })

  it('waits on the source set for Errors', () => {
    expect(errorsSetup({ ...base, sources: [site, sdk], dismissed: true })).toEqual({
      state: 'waiting',
      source: sdk,
    })
  })

  it('starts from the page script first, then any source', () => {
    expect(errorsSetup({ ...base, sources: [api, site] }).source).toBe(site)
    expect(errorsSetup({ ...base, sources: [api] })).toEqual({ state: 'canUse', source: api })
  })

  it('tells nothing yet from a product that won’t use Errors', () => {
    expect(errorsSetup(base).state).toBe('none')
    expect(errorsSetup({ ...base, sources: [site], dismissed: true }).state).toBe('dismissed')
  })
})
