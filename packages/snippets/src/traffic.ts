/**
 * Set up Traffic, as closed in the Traffic canvas (frame 3): where the script
 * goes on each platform, and what each option adds to it.
 */

export const TRAFFIC_PLATFORMS = ['html', 'nextjs', 'react', 'wordpress', 'gtm', 'other'] as const
export type TrafficPlatform = (typeof TRAFFIC_PLATFORMS)[number]

export function isTrafficPlatform(value: string): value is TrafficPlatform {
  return (TRAFFIC_PLATFORMS as readonly string[]).includes(value)
}

export interface SnippetOptions {
  /** The ingest's public address, without a trailing slash. */
  ingestUrl: string
  publicKey: string
  /** The browser keeps a random id: returning visitors count once. */
  persistent: boolean
  /** Count visits from localhost, for testing. */
  local: boolean
}

/** The script tag with the options on. */
export function scriptTag(o: SnippetOptions, close = '></script>') {
  const base = o.ingestUrl.replace(/\/+$/, '')
  const attrs = [
    `src="${base}/o/v1/script.js"`,
    `data-key="${o.publicKey}"`,
    ...(o.persistent ? ['data-visitor="persistent"'] : []),
    ...(o.local ? ['data-local'] : []),
  ]
  return `<script defer ${attrs.join(' ')}${close}`
}

/** Where the code goes and the code, for one platform. */
export function trafficSnippet(platform: TrafficPlatform, o: SnippetOptions) {
  switch (platform) {
    case 'nextjs':
      return {
        file: 'app/layout.tsx',
        code: `import Script from 'next/script'\n\n// Inside <body> of the root layout:\n${scriptTag(o, ' />').replace('<script defer', '<Script defer')}`,
      }
    case 'react':
      return { file: 'index.html', code: scriptTag(o) }
    case 'wordpress':
      return {
        file: 'functions.php',
        code: `add_action('wp_head', function () {\n  echo '${scriptTag(o)}';\n});`,
      }
    case 'gtm':
      return { file: 'Google Tag Manager · Custom HTML · All Pages', code: scriptTag(o) }
    default:
      return { file: '<head>', code: scriptTag(o) }
  }
}
