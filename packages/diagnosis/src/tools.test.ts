import { describe, expect, it } from 'vitest'
import type { Snapshot } from './collect'
import { detectTools } from './report'

function snapshot(parts: Partial<Snapshot>): Snapshot {
  return {
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    reachable: true,
    httpStatus: 200,
    durationMs: 300,
    error: null,
    redirects: [],
    html: '',
    scriptUrls: [],
    linkUrls: [],
    bundles: [],
    httpsRedirect: true,
    tls: null,
    health: null,
    ...parts,
  }
}

const ids = (s: Snapshot) => detectTools(s).map((t) => t.id)

describe('detectTools', () => {
  it('finds Google Analytics and Tag Manager from their loader URLs', () => {
    expect(
      ids(
        snapshot({
          scriptUrls: [
            'https://www.googletagmanager.com/gtag/js?id=G-ABC123',
            'https://www.googletagmanager.com/gtm.js?id=GTM-XYZ',
          ],
        }),
      ),
    ).toEqual(['google-analytics', 'google-tag-manager'])
  })

  it('finds Plausible and Umami', () => {
    const html = `<script defer data-domain="example.com" src="https://plausible.io/js/script.js"></script>
<script defer src="https://cloud.umami.is/script.js" data-website-id="94db1cb1-74f4-4a40-ad6c-962362670409"></script>`
    expect(ids(snapshot({ html }))).toEqual(['plausible', 'umami'])
  })

  it('finds PostHog bundled into a first-party chunk', () => {
    const bundle =
      'posthog.init("phc_abc",{api_host:"https://us.i.posthog.com",person_profiles:"identified_only"})'
    const tools = detectTools(snapshot({ bundles: [bundle] }))
    expect(tools).toEqual([
      { id: 'posthog', name: 'PostHog', categories: ['web', 'product'], evidence: ['bundle'] },
    ])
  })

  it('finds Sentry from a DSN in a bundle', () => {
    const bundle =
      'Sentry.init({dsn:"https://0123456789abcdef@o4504.ingest.us.sentry.io/4505",tracesSampleRate:.1})'
    expect(ids(snapshot({ bundles: [bundle] }))).toEqual(['sentry'])
  })

  it('does not take the word "sentry" alone as Sentry', () => {
    expect(ids(snapshot({ html: '<p>Our sentry tower is open on weekends.</p>' }))).toEqual([])
  })

  it('finds payment and store links', () => {
    expect(
      ids(
        snapshot({
          linkUrls: [
            'https://buy.stripe.com/test_00g5kE',
            'https://www.asaas.com/c/abc123def',
            'https://apps.apple.com/br/app/postato/id123456',
            'https://play.google.com/store/apps/details?id=br.com.postato',
          ],
        }),
      ),
    ).toEqual(['stripe', 'asaas', 'app-store', 'google-play'])
  })

  it('keeps every place a tool was seen', () => {
    const tools = detectTools(
      snapshot({
        scriptUrls: ['https://js.stripe.com/v3/'],
        html: '<script src="https://js.stripe.com/v3/"></script>',
      }),
    )
    expect(tools[0]?.evidence).toEqual(['script', 'html'])
  })
})
