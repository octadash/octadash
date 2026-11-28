/**
 * Set up Errors, as closed in the Errors canvas: the code for each platform.
 * Octadash speaks the Sentry protocol, so every server and app platform is the
 * Sentry SDK with the source's DSN; the browser can use the Octadash script,
 * which reports uncaught errors without an SDK.
 */

export const ERROR_PLATFORMS = [
  'html',
  'nextjs',
  'react',
  'node',
  'python',
  'dotnet',
  'php',
  'java',
  'go',
  'ruby',
  'other',
] as const
export type ErrorPlatform = (typeof ERROR_PLATFORMS)[number]

export function isErrorPlatform(value: string): value is ErrorPlatform {
  return (ERROR_PLATFORMS as readonly string[]).includes(value)
}

/**
 * Set up Errors asks in two steps: where the code runs, then the language.
 * Next.js is in both, since one SDK covers the page and the server.
 */
export const ERROR_RUNTIMES = ['browser', 'server'] as const
export type ErrorRuntime = (typeof ERROR_RUNTIMES)[number]

export const ERROR_PLATFORMS_BY_RUNTIME: Record<ErrorRuntime, readonly ErrorPlatform[]> = {
  browser: ['html', 'react', 'nextjs'],
  server: ['nextjs', 'node', 'python', 'dotnet', 'php', 'java', 'go', 'ruby', 'other'],
}

/** Where a platform's code runs, for the first step: a page script or React is the browser. */
export function errorRuntimeOf(platform: ErrorPlatform): ErrorRuntime {
  return ERROR_PLATFORMS_BY_RUNTIME.browser.includes(platform) ? 'browser' : 'server'
}

export interface ErrorSnippetOptions {
  /** The ingest's public address. */
  ingestUrl: string
  publicKey: string
  /** The source's Sentry DSN. */
  dsn: string
}

export interface ErrorSnippet {
  /** The install command, when the platform has one. */
  install: string | null
  /** Where the code goes. */
  file: string
  code: string
}

/** Where the code goes and the code, for one platform. */
export function errorSnippet(platform: ErrorPlatform, o: ErrorSnippetOptions): ErrorSnippet {
  const dsn = o.dsn
  switch (platform) {
    case 'html': {
      const base = o.ingestUrl.replace(/\/+$/, '')
      return {
        install: null,
        file: '<head>',
        code: `<script defer src="${base}/o/v1/script.js" data-key="${o.publicKey}" data-release="1.0.0"></script>`,
      }
    }
    case 'nextjs':
      return {
        install: 'npm install @sentry/nextjs',
        file: 'instrumentation-client.ts · sentry.server.config.ts',
        code: `import * as Sentry from '@sentry/nextjs'\n\nSentry.init({\n  dsn: '${dsn}',\n  release: process.env.NEXT_PUBLIC_RELEASE,\n})`,
      }
    case 'react':
      return {
        install: 'npm install @sentry/react',
        file: 'src/main.tsx',
        code: `import * as Sentry from '@sentry/react'\n\nSentry.init({\n  dsn: '${dsn}',\n  release: import.meta.env.VITE_RELEASE,\n})`,
      }
    case 'node':
      return {
        install: 'npm install @sentry/node',
        file: 'instrument.js (import it before anything else)',
        code: `const Sentry = require('@sentry/node')\n\nSentry.init({\n  dsn: '${dsn}',\n  release: process.env.RELEASE,\n})`,
      }
    case 'python':
      return {
        install: 'pip install sentry-sdk',
        file: 'main.py',
        code: `import os\nimport sentry_sdk\n\nsentry_sdk.init(\n    dsn="${dsn}",\n    release=os.environ.get("RELEASE"),\n)`,
      }
    case 'dotnet':
      return {
        install: 'dotnet add package Sentry.AspNetCore',
        file: 'Program.cs',
        code: `builder.WebHost.UseSentry(options =>\n{\n    options.Dsn = "${dsn}";\n});`,
      }
    case 'php':
      return {
        install: 'composer require sentry/sentry',
        file: 'bootstrap.php',
        code: `\\Sentry\\init([\n    'dsn' => '${dsn}',\n]);`,
      }
    case 'java':
      return {
        install: "implementation 'io.sentry:sentry:8.+'",
        file: 'Main.java',
        code: `Sentry.init(options -> {\n    options.setDsn("${dsn}");\n});`,
      }
    case 'go':
      return {
        install: 'go get github.com/getsentry/sentry-go',
        file: 'main.go',
        code: `err := sentry.Init(sentry.ClientOptions{\n    Dsn: "${dsn}",\n})`,
      }
    case 'ruby':
      return {
        install: 'bundle add sentry-ruby',
        file: 'config/initializers/sentry.rb',
        code: `Sentry.init do |config|\n  config.dsn = '${dsn}'\nend`,
      }
    default:
      return { install: null, file: 'DSN', code: dsn }
  }
}

/** The error "Send a test error" sends, in the Octadash format. */
export function testError(publicKey: string, now = new Date()) {
  return {
    key: publicKey,
    events: [
      {
        timestamp: now.getTime() / 1000,
        platform: 'javascript',
        level: 'error',
        exception: {
          values: [
            {
              type: 'OctadashTestError',
              value: 'A test error from Set up Errors',
              mechanism: { type: 'generic', handled: true },
            },
          ],
        },
        tags: { octadash_test: 'true' },
      },
    ],
  }
}
