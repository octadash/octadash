import { describe, expect, it } from 'vitest'
import { scriptTag, trafficSnippet } from './traffic-setup'

const base = {
  ingestUrl: 'https://ingest.example.com/',
  publicKey: 'oct_pk_123',
  persistent: false,
  local: false,
}

describe('traffic setup', () => {
  it('writes the script tag with each option it needs', () => {
    expect(scriptTag(base)).toBe(
      '<script defer src="https://ingest.example.com/o/v1/script.js" data-key="oct_pk_123"></script>',
    )
    expect(scriptTag({ ...base, persistent: true, local: true })).toContain(
      'data-key="oct_pk_123" data-visitor="persistent" data-local>',
    )
  })

  it('places the code where each platform needs it', () => {
    expect(trafficSnippet('nextjs', base).code).toContain(
      '<Script defer src="https://ingest.example.com/o/v1/script.js" data-key="oct_pk_123" />',
    )
    expect(trafficSnippet('wordpress', base).code).toContain("add_action('wp_head'")
    expect(trafficSnippet('html', base).file).toBe('<head>')
  })
})
