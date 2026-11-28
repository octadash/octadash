import { describe, expect, it } from 'vitest'
import { ERROR_PLATFORMS, errorSnippet, isErrorPlatform, testError } from './errors-setup'

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
