/**
 * Set up Product usage, as closed in the Product usage canvas: the code that
 * sends an event and ties it to a person, for each platform. The browser uses
 * the Octadash script; servers post the Octadash format with the source key;
 * a product already on PostHog changes only the host.
 */

export const USAGE_TABS = ['browser', 'node', 'python', 'dotnet', 'posthog'] as const
export type UsageTab = (typeof USAGE_TABS)[number]

/** What "Add source" asks: where the code runs. */
export const USAGE_SOURCE_PLATFORMS = [
  'html',
  'nextjs',
  'react',
  'node',
  'python',
  'dotnet',
  'other',
] as const

export function isUsageTab(value: string): value is UsageTab {
  return (USAGE_TABS as readonly string[]).includes(value)
}

/** The tab a source opens on, from where its code runs. */
export function tabOf(platform: string | null): UsageTab {
  if (platform === 'node') return 'node'
  if (platform === 'python') return 'python'
  if (platform === 'dotnet') return 'dotnet'
  return 'browser'
}

export interface UsageSnippetOptions {
  ingestUrl: string
  publicKey: string
  /** The source already has the Octadash script (it sends page views). */
  hasScript: boolean
}

export interface UsageSnippet {
  /** Where the code goes, as a message key under usageSetup.where. */
  where: 'head' | 'page' | 'server' | 'posthog'
  /** Sends one event. */
  track: string
  /** Ties what follows to a person. */
  identify: string
}

export function usageSnippet(tab: UsageTab, o: UsageSnippetOptions): UsageSnippet {
  const base = o.ingestUrl.replace(/\/+$/, '')
  const key = o.publicKey
  switch (tab) {
    case 'browser':
      return {
        where: o.hasScript ? 'page' : 'head',
        track: `${o.hasScript ? '' : `<script defer src="${base}/o/v1/script.js" data-key="${key}"></script>\n\n`}window.octadash.track('signed_up', { plan: 'pro' })`,
        identify: 'window.octadash.identify(user.id)',
      }
    case 'node':
      return {
        where: 'server',
        track: `await fetch('${base}/o/v1/events', {\n  method: 'POST',\n  headers: { 'content-type': 'application/json', 'x-octadash-key': '${key}' },\n  body: JSON.stringify({\n    events: [{ event: 'signed_up', distinct_id: user.id, properties: { plan: 'pro' } }],\n  }),\n})`,
        identify: `// distinct_id in each event is the person: Octadash keeps only a hash of it.\n{ event: 'signed_up', distinct_id: user.id }`,
      }
    case 'python':
      return {
        where: 'server',
        track: `import requests\n\nrequests.post(\n    "${base}/o/v1/events",\n    headers={"x-octadash-key": "${key}"},\n    json={"events": [{"event": "signed_up", "distinct_id": str(user.id), "properties": {"plan": "pro"}}]},\n    timeout=5,\n)`,
        identify: `# distinct_id in each event is the person: Octadash keeps only a hash of it.\n{"event": "signed_up", "distinct_id": str(user.id)}`,
      }
    case 'dotnet':
      return {
        where: 'server',
        track: `using var http = new HttpClient();\nhttp.DefaultRequestHeaders.Add("x-octadash-key", "${key}");\nawait http.PostAsJsonAsync("${base}/o/v1/events", new {\n    events = new[] { new { @event = "signed_up", distinct_id = user.Id.ToString(), properties = new { plan = "pro" } } }\n});`,
        identify: `// distinct_id in each event is the person: Octadash keeps only a hash of it.\nnew { @event = "signed_up", distinct_id = user.Id.ToString() }`,
      }
    case 'posthog':
      return {
        where: 'posthog',
        track: `// Browser (posthog-js): change only the host and the key.\nposthog.init('${key}', { api_host: '${base}' })\n\n// Server (posthog-node)\nconst posthog = new PostHog('${key}', { host: '${base}' })`,
        identify: 'posthog.identify(user.id)',
      }
  }
}
