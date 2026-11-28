import {
  ERROR_PLATFORMS,
  ERROR_PLATFORMS_BY_RUNTIME,
  type ErrorPlatform,
  type ErrorRuntime,
  errorSnippet,
  LOG_TABS,
  type LogTab,
  logSnippet,
  TRAFFIC_PLATFORMS,
  type TrafficPlatform,
  trafficSnippet,
  USAGE_TABS,
  type UsageTab,
  usageSnippet,
} from '@octadash/snippets'
import { ServerCodeBlock } from 'fumadocs-ui/components/codeblock.rsc'
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'
import type { Lang } from '@/lib/i18n'

/**
 * The same code the panel shows under Set up, for every platform, with
 * placeholders where the panel fills in the source's key and address.
 */

const INGEST = 'https://ingest.example.com'
const KEY = 'YOUR_SOURCE_KEY'
const DSN = `https://${KEY}@ingest.example.com/1`

const NAMES: Record<string, string> = {
  html: 'HTML',
  nextjs: 'Next.js',
  react: 'React / Vite',
  wordpress: 'WordPress',
  gtm: 'Google Tag Manager',
  node: 'Node.js',
  python: 'Python',
  dotnet: '.NET',
  java: 'Java',
  go: 'Go',
  php: 'PHP',
  ruby: 'Ruby',
  browser: 'Browser',
  collector: 'OpenTelemetry Collector',
  posthog: 'Already on PostHog',
  other: 'Other',
}

const NAMES_PT: Record<string, string> = {
  browser: 'Navegador',
  posthog: 'Já uso PostHog',
  other: 'Outro',
}

const LOG_NAMES: Record<string, string> = { dotnet: '.NET (Serilog)', node: 'Node (pino)' }
const USAGE_NAMES: Record<string, string> = { node: 'Next.js / Node' }

function label(id: string, lang: Lang, extra: Record<string, string> = {}) {
  if (lang === 'pt' && NAMES_PT[id]) return NAMES_PT[id]
  return extra[id] ?? NAMES[id] ?? id
}

const ERROR_LANG: Record<ErrorPlatform, string> = {
  html: 'html',
  nextjs: 'ts',
  react: 'tsx',
  node: 'js',
  python: 'python',
  dotnet: 'csharp',
  php: 'php',
  java: 'java',
  go: 'go',
  ruby: 'ruby',
  other: 'txt',
}

const TRAFFIC_LANG: Record<TrafficPlatform, string> = {
  html: 'html',
  nextjs: 'tsx',
  react: 'html',
  wordpress: 'php',
  gtm: 'html',
  other: 'html',
}

const LOG_LANG: Record<LogTab, string> = {
  dotnet: 'csharp',
  node: 'bash',
  python: 'python',
  go: 'go',
  collector: 'yaml',
  other: 'bash',
}

const USAGE_LANG: Record<UsageTab, string> = {
  browser: 'html',
  node: 'ts',
  python: 'python',
  dotnet: 'csharp',
  posthog: 'ts',
}

interface Block {
  install?: string | null
  file: string
  code: string
  lang: string
}

function Code({ block }: { block: Block }) {
  return (
    <>
      {block.install && <ServerCodeBlock code={block.install} lang="bash" />}
      <p className="text-sm text-fd-muted-foreground">
        <code>{block.file}</code>
      </p>
      <ServerCodeBlock code={block.code} lang={block.lang} />
    </>
  )
}

function blocks(
  area: Props['area'],
  lang: Lang,
  runtime?: ErrorRuntime,
): { id: string; name: string; blocks: Block[] }[] {
  switch (area) {
    case 'traffic':
      return TRAFFIC_PLATFORMS.map((p) => ({
        id: p,
        name: label(p, lang),
        blocks: [
          {
            ...trafficSnippet(p, {
              ingestUrl: INGEST,
              publicKey: KEY,
              persistent: false,
              local: false,
            }),
            lang: TRAFFIC_LANG[p],
          },
        ],
      }))
    case 'errors':
      return (runtime ? ERROR_PLATFORMS_BY_RUNTIME[runtime] : ERROR_PLATFORMS).map((p) => ({
        id: p,
        name: label(p, lang),
        blocks: [
          {
            ...errorSnippet(p, { ingestUrl: INGEST, publicKey: KEY, dsn: DSN }),
            lang: ERROR_LANG[p],
          },
        ],
      }))
    case 'logs':
      return LOG_TABS.map((t) => ({
        id: t,
        name: label(t, lang, LOG_NAMES),
        blocks: [
          {
            ...logSnippet(t, { ingestUrl: INGEST, publicKey: KEY, service: 'api' }),
            lang: LOG_LANG[t],
          },
        ],
      }))
    case 'usage':
      return USAGE_TABS.map((t) => {
        const s = usageSnippet(t, { ingestUrl: INGEST, publicKey: KEY, hasScript: false })
        const where = lang === 'pt' ? WHERE_PT[s.where] : WHERE[s.where]
        return {
          id: t,
          name: label(t, lang, USAGE_NAMES),
          blocks: [
            { file: where, code: s.track, lang: USAGE_LANG[t] },
            {
              file: lang === 'pt' ? 'Quem é a pessoa' : 'Who the person is',
              code: s.identify,
              lang: USAGE_LANG[t],
            },
          ],
        }
      })
  }
}

const WHERE = {
  head: "The script in '<head>', then the call where it happens",
  page: 'Where it happens, in the page',
  server: 'Where it happens, in your server code',
  posthog: 'Where PostHog starts',
}

const WHERE_PT = {
  head: "O script no '<head>', depois a chamada onde acontece",
  page: 'Onde acontece, na página',
  server: 'Onde acontece, no código do servidor',
  posthog: 'Onde o PostHog é iniciado',
}

interface Props {
  area: 'traffic' | 'errors' | 'logs' | 'usage'
  lang: Lang
  /** Errors: only the platforms of one place, as the panel asks (browser, then server). */
  runtime?: ErrorRuntime
}

export function Snippets({ area, lang, runtime }: Props) {
  const items = blocks(area, lang, runtime)
  return (
    <Tabs
      items={items.map((i) => i.name)}
      groupId={`snippets-${area}${runtime ? `-${runtime}` : ''}`}
      persist
    >
      {items.map((item) => (
        <Tab key={item.id} value={item.name}>
          {item.blocks.map((b) => (
            <Code key={b.file} block={b} />
          ))}
        </Tab>
      ))}
    </Tabs>
  )
}
