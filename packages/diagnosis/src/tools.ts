import type { ToolCategory } from './types'

export interface ToolRule {
  id: string
  name: string
  categories: ToolCategory[]
  /** Matched against script URLs, link URLs, the HTML and first-party bundles. */
  pattern: RegExp
}

/**
 * Known tools, found by the URLs they load or the globals they leave in the
 * page. Patterns are deliberately specific: a false "you have Sentry" is worse
 * than a missed one. Contributions welcome; add a test with a real snippet.
 */
export const TOOL_RULES: ToolRule[] = [
  // Web analytics
  {
    id: 'google-analytics',
    name: 'Google Analytics',
    categories: ['web'],
    pattern: /googletagmanager\.com\/gtag\/js|google-analytics\.com\/(?:analytics|ga|g\/collect)/,
  },
  {
    id: 'google-tag-manager',
    name: 'Google Tag Manager',
    categories: ['web'],
    pattern: /googletagmanager\.com\/gtm\.js/,
  },
  {
    id: 'plausible',
    name: 'Plausible',
    categories: ['web'],
    pattern: /plausible\.io\/js\/|window\.plausible\s*=/,
  },
  {
    id: 'umami',
    name: 'Umami',
    categories: ['web'],
    pattern:
      /cloud\.umami\.is|umami\.is\/script\.js|\/umami\.js|data-website-id=["'][0-9a-f-]{36}|data-umami-event=/,
  },
  {
    id: 'vercel-analytics',
    name: 'Vercel Analytics',
    categories: ['web'],
    pattern: /\/_vercel\/insights\/script\.js|va\.vercel-scripts\.com/,
  },
  {
    id: 'cloudflare-analytics',
    name: 'Cloudflare Web Analytics',
    categories: ['web'],
    pattern: /static\.cloudflareinsights\.com\/beacon/,
  },
  { id: 'fathom', name: 'Fathom', categories: ['web'], pattern: /cdn\.usefathom\.com/ },
  {
    id: 'simple-analytics',
    name: 'Simple Analytics',
    categories: ['web'],
    pattern: /scripts\.simpleanalyticscdn\.com/,
  },
  {
    id: 'matomo',
    name: 'Matomo',
    categories: ['web'],
    pattern: /matomo\.js|piwik\.js|_paq\.push\(/,
  },
  {
    id: 'microsoft-clarity',
    name: 'Microsoft Clarity',
    categories: ['web'],
    pattern: /clarity\.ms\/tag\//,
  },
  { id: 'hotjar', name: 'Hotjar', categories: ['web'], pattern: /static\.hotjar\.com/ },

  // Product analytics (also count as web analytics: they record page views)
  {
    id: 'posthog',
    name: 'PostHog',
    categories: ['web', 'product'],
    // Project keys start with phc_; apps behind a reverse proxy still ship the key and ui_host.
    pattern:
      /phc_[A-Za-z0-9]{30,}|[a-z0-9-]+\.i\.posthog\.com|(?:app|us|eu)\.posthog\.com|posthog\.init\(|__POSTHOG/,
  },
  {
    id: 'mixpanel',
    name: 'Mixpanel',
    categories: ['web', 'product'],
    pattern: /cdn\.mxpnl\.com|api-js\.mixpanel\.com|mixpanel\.init\(/,
  },
  {
    id: 'amplitude',
    name: 'Amplitude',
    categories: ['web', 'product'],
    pattern: /cdn\.amplitude\.com|api2\.amplitude\.com|amplitude\.getInstance\(/,
  },
  {
    id: 'segment',
    name: 'Segment',
    categories: ['product'],
    pattern: /cdn\.segment\.com\/analytics\.js|cdn\.segment\.com\/v1\/projects/,
  },
  { id: 'heap', name: 'Heap', categories: ['web', 'product'], pattern: /cdn\.heapanalytics\.com/ },

  // Error tracking
  {
    id: 'sentry',
    name: 'Sentry',
    categories: ['errors'],
    pattern: /sentry-cdn\.com|ingest(?:\.[a-z]{2})?\.sentry\.io|__SENTRY__/,
  },
  {
    id: 'bugsnag',
    name: 'Bugsnag',
    categories: ['errors'],
    pattern: /d2wy8f7a9ursnm\.cloudfront\.net|sessions\.bugsnag\.com|notify\.bugsnag\.com/,
  },
  {
    id: 'rollbar',
    name: 'Rollbar',
    categories: ['errors'],
    pattern: /cdn\.rollbar\.com|api\.rollbar\.com|_rollbarConfig/,
  },
  {
    id: 'logrocket',
    name: 'LogRocket',
    categories: ['errors'],
    pattern: /cdn\.lr-ingest\.(?:io|com)|cdn\.logrocket\.(?:io|com)/,
  },
  {
    id: 'datadog-rum',
    name: 'Datadog RUM',
    categories: ['errors'],
    pattern: /datadoghq-browser-agent\.com|DD_RUM\.init/,
  },
  {
    id: 'new-relic',
    name: 'New Relic',
    categories: ['errors'],
    pattern: /js-agent\.newrelic\.com|bam\.nr-data\.net/,
  },
  { id: 'highlight', name: 'Highlight', categories: ['errors'], pattern: /highlight\.run/ },

  // Payments
  {
    id: 'stripe',
    name: 'Stripe',
    categories: ['payments'],
    pattern: /js\.stripe\.com|buy\.stripe\.com|checkout\.stripe\.com/,
  },
  {
    id: 'paddle',
    name: 'Paddle',
    categories: ['payments'],
    pattern: /cdn\.paddle\.com|checkout\.paddle\.com|buy\.paddle\.com/,
  },
  {
    id: 'asaas',
    name: 'Asaas',
    categories: ['payments'],
    pattern: /(?:www\.)?asaas\.com\/(?:c|i)\/[A-Za-z0-9]/,
  },
  {
    id: 'mercado-pago',
    name: 'Mercado Pago',
    categories: ['payments'],
    pattern: /sdk\.mercadopago\.com|mpago\.la\/|mercadopago\.com\.br\/checkout/,
  },
  {
    id: 'lemon-squeezy',
    name: 'Lemon Squeezy',
    categories: ['payments'],
    pattern: /[a-z0-9-]+\.lemonsqueezy\.com\/(?:checkout|buy)|app\.lemonsqueezy\.com\/js/,
  },
  { id: 'hotmart', name: 'Hotmart', categories: ['payments'], pattern: /pay\.hotmart\.com/ },
  { id: 'kiwify', name: 'Kiwify', categories: ['payments'], pattern: /pay\.kiwify\.com\.br/ },

  // App stores (the product may sell through them)
  {
    id: 'app-store',
    name: 'App Store',
    categories: ['stores'],
    pattern: /apps\.apple\.com\/(?:[a-z]{2}\/)?app\//,
  },
  {
    id: 'google-play',
    name: 'Google Play',
    categories: ['stores'],
    pattern: /play\.google\.com\/store\/apps\/details/,
  },

  // Ads pixels: reported, but they do not answer any level
  {
    id: 'meta-pixel',
    name: 'Meta Pixel',
    categories: ['ads'],
    pattern: /connect\.facebook\.net\/[a-zA-Z_]+\/fbevents\.js/,
  },
]
