import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const config: NextConfig = {
  // Self-contained server for the Docker image.
  output: 'standalone',
  // Trace files from the monorepo root so workspace packages end up in the image.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  transpilePackages: [
    '@octadash/core',
    '@octadash/db',
    '@octadash/auth',
    '@octadash/integrations',
    '@octadash/uptime',
  ],
  // pg is loaded at runtime from node_modules, never bundled.
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  // The repository has its own AGENTS.md; next dev should not write one into apps/web.
  agentRules: false,
}

export default withNextIntl(config)
