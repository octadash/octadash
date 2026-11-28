import { describe, expect, it } from 'vitest'
import { hasPageScript, sourceAreas } from './sources'

describe('one install per source', () => {
  it('gives a page script source Traffic, Errors and Product usage', () => {
    expect(sourceAreas('nextjs', ['traffic'])).toEqual(['errors', 'traffic', 'usage'])
    expect(sourceAreas('html', ['usage'])).toEqual(['errors', 'traffic', 'usage'])
    expect(sourceAreas('html', ['errors'])).toEqual(['errors', 'traffic', 'usage'])
    expect(sourceAreas('wordpress', ['traffic'])).toEqual(['errors', 'traffic', 'usage'])
  })

  it('leaves alone what is not the page script', () => {
    // Errors on Next.js is the Sentry SDK, not the script.
    expect(hasPageScript('nextjs', ['errors'])).toBe(false)
    expect(sourceAreas('nextjs', ['errors'])).toEqual(['errors'])
    expect(sourceAreas('node', ['usage', 'errors'])).toEqual(['errors', 'usage'])
    expect(sourceAreas('dotnet', ['logs'])).toEqual(['logs'])
    expect(sourceAreas('html', [])).toEqual([])
  })
})
